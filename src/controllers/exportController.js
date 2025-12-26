const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execAsync = promisify(exec);

/**
 * Controller para facilitar exportação e upload manual
 */

/**
 * GET /api/export/open-folder/:jobId
 * Abre a pasta de outputs de um job específico
 */
async function openOutputFolder(req, res) {
  try {
    const { jobId } = req.params;
    const outputPath = path.join(config.DOWNLOADS_DIR, jobId);

    // Verificar se a pasta existe
    if (!fs.existsSync(outputPath)) {
      return res.status(404).json({ error: 'Pasta não encontrada' });
    }

    // Comando para abrir pasta no explorer do sistema
    const platform = process.platform;
    let command;

    switch (platform) {
      case 'win32':
        command = `explorer "${outputPath}"`;
        break;
      case 'darwin':
        command = `open "${outputPath}"`;
        break;
      case 'linux':
        command = `xdg-open "${outputPath}"`;
        break;
      default:
        return res.status(500).json({ error: 'Sistema operacional não suportado' });
    }

    await execAsync(command);

    res.json({
      success: true,
      message: 'Pasta aberta no explorador de arquivos',
      path: outputPath,
    });
  } catch (error) {
    console.error('Erro ao abrir pasta:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/export/prepare-tiktok/:jobId
 * Prepara clipes para upload manual no TikTok
 * - Copia vídeos e capas para pasta específica
 * - Renomeia com formato amigável
 * - Cria arquivo de descrições
 */
async function prepareForTikTok(req, res) {
  try {
    const { jobId } = req.params;
    const jobPath = path.join(config.DOWNLOADS_DIR, jobId);
    const tiktokPath = path.join(jobPath, 'tiktok-ready');

    // Verificar se job existe
    if (!fs.existsSync(jobPath)) {
      return res.status(404).json({ error: 'Job não encontrado' });
    }

    // Criar pasta "tiktok-ready"
    if (!fs.existsSync(tiktokPath)) {
      fs.mkdirSync(tiktokPath, { recursive: true });
    }

    const metadataPath = path.join(jobPath, 'metadata.json');

    // Ler metadata (se existir) ou buscar clipes diretamente
    let metadata = { clips: [] };
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } else {
      // Fallback: buscar clipes diretamente na pasta
      const files = fs.readdirSync(jobPath);
      const clipFiles = files
        .filter(f => f.match(/^clip_\d+\.mp4$/))
        .sort((a, b) => {
          const numA = parseInt(a.match(/\d+/)[0]);
          const numB = parseInt(b.match(/\d+/)[0]);
          return numA - numB;
        });

      metadata.clips = clipFiles.map((filename, index) => {
        const clipNumber = index + 1;
        return {
          number: clipNumber,
          filename: filename,
          title: `Clipe ${clipNumber}`,
          description: '',
          tiktokDescription: '',
        };
      });
    }

    // Preparar arquivos
    const prepared = [];
    const descriptions = [];

    for (let i = 0; i < metadata.clips.length; i++) {
      const clip = metadata.clips[i];
      const clipNumber = String(i + 1).padStart(2, '0');

      // Nome amigável baseado no título
      const safeTitle = (clip.title || `Clipe ${i + 1}`)
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 30);

      const videoName = `${clipNumber}_${safeTitle}.mp4`;
      const coverName = `${clipNumber}_${safeTitle}_capa.jpg`;

      // Copiar vídeo (buscar na raiz do jobPath)
      const sourceVideo = path.join(jobPath, clip.filename);
      const destVideo = path.join(tiktokPath, videoName);

      if (fs.existsSync(sourceVideo)) {
        fs.copyFileSync(sourceVideo, destVideo);
        prepared.push({ type: 'video', name: videoName });
      }

      // Copiar capa (buscar na raiz do jobPath com padrão clip_NNN_cover.png)
      const clipNumberForCover = String(clip.number).padStart(3, '0');
      const sourceCover = path.join(jobPath, `clip_${clipNumberForCover}_cover.png`);
      const destCover = path.join(tiktokPath, coverName);

      if (fs.existsSync(sourceCover)) {
        fs.copyFileSync(sourceCover, destCover);
        prepared.push({ type: 'cover', name: coverName });
      }

      // Guardar descrição
      descriptions.push({
        numero: i + 1,
        video: videoName,
        titulo: clip.title || `Clipe ${i + 1}`,
        descricao: clip.tiktokDescription || clip.description || '',
      });
    }

    // Criar arquivo de descrições
    const descriptionsFile = path.join(tiktokPath, 'DESCRICOES.txt');
    let descriptionsText = '═══════════════════════════════════════\n';
    descriptionsText += '  DESCRIÇÕES PARA TIKTOK\n';
    descriptionsText += '═══════════════════════════════════════\n\n';

    descriptions.forEach(desc => {
      descriptionsText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      descriptionsText += `CLIPE ${desc.numero}: ${desc.video}\n`;
      descriptionsText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      descriptionsText += `${desc.descricao}\n\n`;
      descriptionsText += `─────────────────────────────────────────\n\n`;
    });

    descriptionsText += '\n═══════════════════════════════════════\n';
    descriptionsText += '  INSTRUÇÕES:\n';
    descriptionsText += '═══════════════════════════════════════\n\n';
    descriptionsText += '1. Abra o TikTok no seu celular\n';
    descriptionsText += '2. Toque no botão "+"\n';
    descriptionsText += '3. Selecione "Upload"\n';
    descriptionsText += '4. Escolha o vídeo correspondente\n';
    descriptionsText += '5. Copie e cole a descrição acima\n';
    descriptionsText += '6. Adicione a capa (opcional)\n';
    descriptionsText += '7. Publique!\n\n';

    fs.writeFileSync(descriptionsFile, descriptionsText, 'utf-8');

    // Criar README
    const readmeFile = path.join(tiktokPath, 'LEIA-ME.txt');
    const readmeText = `
╔═══════════════════════════════════════════════════════════╗
║           PASTA PRONTA PARA TIKTOK                        ║
╚═══════════════════════════════════════════════════════════╝

Esta pasta contém tudo que você precisa para publicar no TikTok:

📹 VÍDEOS: Arquivos .mp4 prontos para upload
🖼️  CAPAS: Thumbnails .jpg para usar como capa
📝 DESCRIÇÕES: Arquivo DESCRICOES.txt com textos prontos

═══════════════════════════════════════════════════════════

📱 COMO PUBLICAR NO TIKTOK:

MÉTODO 1: Desktop (TikTok Web)
1. Acesse: https://www.tiktok.com/upload
2. Arraste o vídeo
3. Cole a descrição do arquivo DESCRICOES.txt
4. Publique

MÉTODO 2: Mobile (Mais fácil)
1. Transfira os vídeos para seu celular
   - Via cabo USB
   - Google Drive / OneDrive
   - AirDrop (iOS)
2. Abra TikTok → "+" → "Upload"
3. Selecione o vídeo
4. Cole a descrição correspondente
5. Adicione a capa (opcional)
6. Publique

═══════════════════════════════════════════════════════════

💡 DICAS:

✓ Publique em horários de pico (18h-22h)
✓ Use as hashtags sugeridas nas descrições
✓ Interaja com comentários nas primeiras horas
✓ Publique consistentemente (1-3 vídeos/dia)

═══════════════════════════════════════════════════════════

Total de clipes: ${descriptions.length}

Boas publicações! 🚀
`;

    fs.writeFileSync(readmeFile, readmeText, 'utf-8');

    res.json({
      success: true,
      message: `${prepared.length} arquivos preparados para TikTok`,
      path: tiktokPath,
      files: prepared,
      clipsCount: descriptions.length,
    });
  } catch (error) {
    console.error('Erro ao preparar para TikTok:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * GET /api/export/copy-description/:jobId/:clipIndex
 * Copia descrição de um clipe específico para clipboard (retorna para frontend copiar)
 */
async function getClipDescription(req, res) {
  try {
    const { jobId, clipIndex } = req.params;
    const index = parseInt(clipIndex);

    const metadataPath = path.join(config.DOWNLOADS_DIR, jobId, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'Metadata não encontrada' });
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));

    if (!metadata.clips[index]) {
      return res.status(404).json({ error: 'Clipe não encontrado' });
    }

    const clip = metadata.clips[index];
    const description = clip.tiktokDescription || clip.description;

    res.json({
      success: true,
      title: clip.title,
      description: description,
      clipNumber: index + 1,
      totalClips: metadata.clips.length,
    });
  } catch (error) {
    console.error('Erro ao obter descrição:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  openOutputFolder,
  prepareForTikTok,
  getClipDescription,
};
