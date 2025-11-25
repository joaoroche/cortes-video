const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');
const config = require('../config');
const { openai, processBatchParallel } = require('./transcriptionService');

// Requer o hashCode em strings
require('../utils/formatters');

// Cache para prompts de imagens DALL-E
const imagePromptCache = new Map();

/**
 * Desenha gradiente de fundo (fallback)
 */
function drawGradientBackground(ctx, width, height, clipDescription) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);

  const colors = [
    { start: '#667eea', end: '#764ba2' },
    { start: '#f093fb', end: '#f5576c' },
    { start: '#4facfe', end: '#00f2fe' },
    { start: '#43e97b', end: '#38f9d7' },
    { start: '#fa709a', end: '#fee140' },
  ];

  const colorIndex = Math.abs(clipDescription.hashCode() || 0) % colors.length;
  const selectedColor = colors[colorIndex];

  gradient.addColorStop(0, selectedColor.start);
  gradient.addColorStop(1, selectedColor.end);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Padrão decorativo
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  for (let i = 0; i < 10; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const radius = Math.random() * 200 + 50;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Gera capa simples sem DALL-E (fallback rápido)
 */
async function generateSimpleCover(clipDescription, outputPath) {
  const width = 1080;
  const height = 1920;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  drawGradientBackground(ctx, width, height, clipDescription);

  // Texto "pensarFazRico"
  ctx.fillStyle = '#FFFF00';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 10;
  ctx.font = 'bold 90px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const brandText = 'pensarFazRico';
  const textX = width / 2;
  const textY = 120;

  ctx.strokeText(brandText, textX, textY);
  ctx.fillText(brandText, textX, textY);

  // Descrição do clipe
  if (clipDescription && clipDescription.length > 0) {
    ctx.font = 'bold 64px Arial';
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 8;

    const maxWidth = width - 100;
    const words = clipDescription.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    });
    lines.push(currentLine.trim());

    const displayLines = lines.slice(0, 3);
    const lineHeight = 90;
    const startY = (height / 2) - ((displayLines.length * lineHeight) / 2);

    const boxPadding = 30;
    const boxHeight = displayLines.length * lineHeight + boxPadding * 2;
    const boxY = startY - boxPadding;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(50, boxY, width - 100, boxHeight);

    ctx.fillStyle = '#FFFFFF';
    displayLines.forEach((line, index) => {
      const y = startY + (index * lineHeight);
      ctx.strokeText(line, textX, y);
      ctx.fillText(line, textX, y);
    });
  }

  // Badge no rodapé
  ctx.font = 'bold 40px Arial';
  ctx.fillStyle = '#FFFF00';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 6;
  const badgeText = '▶ ASSISTA AGORA';
  const badgeY = height - 150;

  ctx.strokeText(badgeText, textX, badgeY);
  ctx.fillText(badgeText, textX, badgeY);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

/**
 * Gera prompt otimizado para DALL-E
 */
async function generateImagePrompt(clipDescription) {
  const cacheKey = clipDescription.toLowerCase().trim().substring(0, 100);

  if (imagePromptCache.has(cacheKey)) {
    console.log('Usando prompt de imagem do cache');
    return imagePromptCache.get(cacheKey);
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Voce e um especialista em criar prompts visuais para geracao de imagens com IA. Crie prompts em ingles que resultem em imagens impactantes.',
        },
        {
          role: 'user',
          content: `Crie um prompt (max 500 chars) para uma imagem de capa IMPACTANTE baseada em:

"${clipDescription}"

REQUISITOS:
- Representar visualmente o tema principal
- Cores vibrantes
- Estilo: fotografia profissional OU ilustracao digital
- EVITAR: texto, rostos especificos

Retorne APENAS o prompt em ingles.`,
        },
      ],
      temperature: 0.6,
      max_tokens: 200,
    });

    let prompt = response.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
    prompt += ', highly detailed, vibrant saturated colors, dramatic lighting, professional composition, 4k quality';

    if (prompt.length > 1000) prompt = prompt.substring(0, 997) + '...';

    imagePromptCache.set(cacheKey, prompt);

    if (imagePromptCache.size > 50) {
      const firstKey = imagePromptCache.keys().next().value;
      imagePromptCache.delete(firstKey);
    }

    return prompt;
  } catch (error) {
    console.warn('Erro ao gerar prompt:', error.message);
    return `Visual representation of: ${clipDescription.substring(0, 150)}, vibrant colors, professional photography`;
  }
}

/**
 * Gera imagem de capa para TikTok com DALL-E
 */
async function generateTikTokCover(clipDescription, outputPath) {
  const width = 1080;
  const height = 1920;

  const imagePrompt = await generateImagePrompt(clipDescription);
  console.log(`Gerando imagem DALL-E: ${imagePrompt.substring(0, 100)}...`);

  const dalleResponse = await openai.images.generate({
    model: 'dall-e-3',
    prompt: imagePrompt,
    n: 1,
    size: '1024x1792',
    quality: 'standard',
    style: 'vivid',
  });

  const backgroundImageUrl = dalleResponse.data[0].url;

  const { default: fetch } = await import('node-fetch');
  const { loadImage } = require('canvas');

  const imageResponse = await fetch(backgroundImageUrl);
  const imageBuffer = await imageResponse.buffer();
  const image = await loadImage(imageBuffer);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(image, 0, 0, width, height);

  // Overlay
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
  gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.6)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Texto "pensarFazRico"
  ctx.fillStyle = '#FFFF00';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 10;
  ctx.font = 'bold 90px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const brandText = 'pensarFazRico';
  const textX = width / 2;
  const textY = 120;

  ctx.strokeText(brandText, textX, textY);
  ctx.fillText(brandText, textX, textY);

  // Descrição
  if (clipDescription && clipDescription.length > 0) {
    ctx.font = 'bold 64px Arial';
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 8;

    const maxWidth = width - 100;
    const words = clipDescription.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    });
    lines.push(currentLine.trim());

    const displayLines = lines.slice(0, 3);
    const lineHeight = 90;
    const startY = (height / 2) - ((displayLines.length * lineHeight) / 2);

    const boxPadding = 30;
    const boxHeight = displayLines.length * lineHeight + boxPadding * 2;
    const boxY = startY - boxPadding;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(50, boxY, width - 100, boxHeight);

    ctx.fillStyle = '#FFFFFF';
    displayLines.forEach((line, index) => {
      const y = startY + (index * lineHeight);
      ctx.strokeText(line, textX, y);
      ctx.fillText(line, textX, y);
    });
  }

  // Badge
  ctx.font = 'bold 40px Arial';
  ctx.fillStyle = '#FFFF00';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 6;
  const badgeText = '▶ ASSISTA AGORA';
  const badgeY = height - 150;

  ctx.strokeText(badgeText, textX, badgeY);
  ctx.fillText(badgeText, textX, badgeY);

  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}

/**
 * Gera descrição do TikTok
 */
async function generateTikTokDescription(clipTitle, clipDescription, keywords, clipNumber, totalClips) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Voce e um especialista em criar descricoes virais para TikTok em portugues do Brasil.',
        },
        {
          role: 'user',
          content: `Crie uma descricao atraente para TikTok (max 4000 chars):

Titulo: ${clipTitle}
Descricao: ${clipDescription}
Keywords: ${keywords ? keywords.join(', ') : 'N/A'}
Parte: ${clipNumber} de ${totalClips}

Requisitos:
- Comecar com "Parte ${clipNumber}"
- Incluir emojis
- Hashtags fixas: #fyp #explore
- Entre 200-500 caracteres
- Incentivar interacao`,
        },
      ],
      temperature: 0.8,
      max_tokens: 1000,
    });

    let finalDescription = response.choices[0].message.content.trim();

    if (!finalDescription.includes('#fyp')) finalDescription += ' #fyp';
    if (!finalDescription.includes('#explore')) finalDescription += ' #explore';

    if (finalDescription.length > 4000) {
      finalDescription = finalDescription.substring(0, 3997) + '...';
    }

    return finalDescription;
  } catch (error) {
    const fallback = `Parte ${clipNumber} - ${clipDescription || clipTitle}

🔥 Confira esse conteudo incrivel!

#fyp #explore ${keywords ? keywords.map(k => '#' + k.replace(/\s+/g, '')).join(' ') : ''}`;

    return fallback.substring(0, 4000);
  }
}

/**
 * Gera capas e descrições do TikTok em paralelo
 */
async function generateCoversAndTikTokDescriptions(clips, jobId, jobDir) {
  const clipItems = clips.map(clip => ({
    clip,
    coverFileName: `clip_${String(clip.number).padStart(3, '0')}_cover.png`,
    coverPath: path.join(jobDir, `clip_${String(clip.number).padStart(3, '0')}_cover.png`),
  }));

  const processClipAssets = async (item) => {
    const { clip, coverFileName, coverPath } = item;

    try {
      const [coverResult, tiktokDescription] = await Promise.all([
        config.USE_DALLE_COVERS
          ? generateTikTokCover(clip.title, coverPath)
              .then(() => ({ success: true, url: `/downloads/${jobId}/${coverFileName}` }))
              .catch(error => {
                console.error(`[${jobId}] Erro capa ${clip.number}:`, error.message);
                return { success: false, url: null };
              })
          : generateSimpleCover(clip.title, coverPath)
              .then(() => ({ success: true, url: `/downloads/${jobId}/${coverFileName}` }))
              .catch(error => {
                console.error(`[${jobId}] Erro capa simples ${clip.number}:`, error.message);
                return { success: false, url: null };
              }),

        generateTikTokDescription(clip.title, clip.description, clip.keywords, clip.number, clips.length)
          .catch(error => {
            console.error(`[${jobId}] Erro descricao TikTok ${clip.number}:`, error.message);
            return `Parte ${clip.number} - ${clip.description}\n\n#fyp #explore`;
          }),
      ]);

      if (coverResult.success) {
        clip.coverUrl = coverResult.url;
        console.log(`[${jobId}] Capa gerada para clipe ${clip.number}`);
      }
      clip.tiktokDescription = tiktokDescription;
      console.log(`[${jobId}] Descricao TikTok gerada para clipe ${clip.number}`);

      return { success: true, clipNumber: clip.number };
    } catch (error) {
      console.error(`[${jobId}] Erro assets clipe ${clip.number}:`, error.message);
      clip.tiktokDescription = `Parte ${clip.number} - ${clip.description}\n\n#fyp #explore`;
      return { success: false, clipNumber: clip.number };
    }
  };

  console.log(`[${jobId}] Gerando ${clipItems.length} capas e descricoes...`);
  await processBatchParallel(clipItems, processClipAssets, config.COVER_GENERATION_BATCH);
  console.log(`[${jobId}] Capas e descricoes geradas!`);
}

module.exports = {
  generateSimpleCover,
  generateTikTokCover,
  generateTikTokDescription,
  generateCoversAndTikTokDescriptions,
};
