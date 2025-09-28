// server.js (CommonJS)
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// dossier d'uploads (crée si nécessaire)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

// configuration multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random()*1e6)}${ext}`;
    cb(null, name);
  }
});

const fileFilter = (req, file, cb) => {
  // n'accepter que les images
  if (file.mimetype.startsWith('image/')) cb(null, true);
  else cb(new Error('Seules les images sont acceptées.'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 6 * 1024 * 1024 } // 6 MB max, ajuste si besoin
});

// rendre le dossier uploads accessible (ex: /uploads/xxxxx.jpg)
app.use('/uploads', express.static(UPLOAD_DIR));

// route de test
app.get('/api/test', (req, res) => res.json({ ok: true }));

/**
 * POST /api/decor
 * FormData { photo: File, style: string }
 * Retourne des suggestions textuelles de l'IA et le chemin de l'image uploadée.
 */
app.post('/api/decor', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucune image reçue.' });

    const style = req.body.style || 'moderne';
    // URL publique accessible par le navigateur. Attention : OpenAI ne pourra pas fetcher cette URL si ton serveur est local non-public.
    const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

    // Construire le prompt pour l'IA
    const prompt = `
Tu es un décorateur d'intérieur professionnel.
L'utilisateur a fourni une photo (accessible à ${imageUrl}) et souhaite un style : ${style}.
Donne 5 suggestions courtes, concrètes et actionnables pour redécorer la pièce (meubles, couleurs, accessoires, texture, éclairage).
Répond en JSON avec une clé "suggestions" contenant un tableau de 5 strings.
`;

    // Appel OpenAI Chat Completions via REST
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY introuvable côté serveur.' });

    const openaiResp = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo', // tu peux changer pour un modèle plus puissant si disponible
      messages: [
        { role: 'system', content: 'You are a helpful interior designer that returns JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.8,
      max_tokens: 400
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    const aiText = openaiResp.data.choices?.[0]?.message?.content || '';
    // essayer de parser un JSON si l'IA a répondu en JSON ; sinon renvoyer le texte brut
    let suggestions = null;
    try { 
      const maybeObj = JSON.parse(aiText);
      if (maybeObj && Array.isArray(maybeObj.suggestions)) suggestions = maybeObj.suggestions;
    } catch (e) {
      // pas JSON -> on passe à l'extraction basique : split par lignes
      suggestions = aiText.split('\n').filter(Boolean).slice(0,5);
    }

    res.json({ suggestions, imageUrl });
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    res.status(500).json({ error: 'Erreur serveur lors de la génération IA.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend démarré sur http://localhost:${PORT}`));
