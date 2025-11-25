# Cortes de Vídeo do YouTube 🎬

Sistema completo para download, divisão e **preparação** de vídeos do YouTube em clipes otimizados para TikTok e redes sociais.

## ✨ Funcionalidades

### Processamento de Vídeo
- 📹 **3 Modos de Processamento**:
  - **Sequencial**: Divisão em clipes de 1 minuto (Parte 1, 2, 3...)
  - **Inteligente**: IA detecta momentos virais (60±15s)
  - **Curiosidades**: Histórias completas com duração variável (20s-4min)
- 🎥 Interface web simples e intuitiva
- ⬇️ Download de vídeos do YouTube
- 📝 Legendas embutidas automáticas
- 🎤 Transcrição com Whisper (OpenAI) ou legendas do YouTube (gratuito)
- 🤖 Análise inteligente de conteúdo com GPT-4

### Geração de Conteúdo
- 🎨 **Capas personalizadas com DALL-E 3** - geradas automaticamente
- 📱 Descrições otimizadas para TikTok com hashtags
- 🎯 Títulos atrativos gerados por IA
- 📊 Sistema de scoring de viralidade

### **🆕 Preparação Automática para TikTok**
- 📁 Organização automática de arquivos para upload
- 📝 Geração de descrições otimizadas prontas para copiar
- 🖼️ Capas correspondentes a cada vídeo
- 📂 Abertura automática da pasta com clipes prontos
- 📋 Arquivo de instruções de upload incluído

## Requisitos

Antes de começar, você precisa ter instalado:

- [Node.js](https://nodejs.org/) (versão 14 ou superior)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (para download de vídeos)
- [FFmpeg](https://ffmpeg.org/download.html) (para processamento de vídeos)
- Chave da API OpenAI (para transcrição, descrições e geração de capas)

### Instalando yt-dlp

#### Windows
```bash
# Usando winget
winget install yt-dlp

# OU baixe o executável em https://github.com/yt-dlp/yt-dlp/releases
# e adicione ao PATH do sistema
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install yt-dlp

# OU usando pip
pip install yt-dlp
```

#### macOS
```bash
brew install yt-dlp
```

### Instalando FFmpeg

#### Windows
1. Baixe o FFmpeg em https://ffmpeg.org/download.html
2. Extraia o arquivo ZIP
3. Adicione a pasta `bin` do FFmpeg ao PATH do sistema

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install ffmpeg
```

#### macOS
```bash
brew install ffmpeg
```

## Instalação

1. Clone ou baixe este repositório

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:

Crie um arquivo `.env` na raiz do projeto com as seguintes variáveis:

```env
OPENAI_API_KEY=sua-chave-api-aqui
BATCH_SIZE=2
AUDIO_QUALITY=64
```

**Obtenha sua chave da API OpenAI:**
- Acesse https://platform.openai.com/api-keys
- Crie uma nova chave de API
- Cole no arquivo `.env`

**Nota:** A geração de capas usa DALL-E 3, que tem um custo por imagem gerada. Se você quiser economizar, o sistema possui fallback automático para gradientes coloridos caso a geração com IA falhe.

## 🚀 Como Usar

### Processando Vídeos

1. Inicie o servidor:
```bash
npm start
```

Para desenvolvimento (com auto-reload):
```bash
npm run dev
```

2. Abra o navegador e acesse:
```
http://localhost:3000
```

3. Cole o link de um vídeo do YouTube no campo de entrada

4. Escolha o modo de processamento (Sequencial, Inteligente ou Curiosidades)

5. Clique em "Processar Vídeo"

6. Aguarde o processamento (pode levar alguns minutos)

7. Veja os clipes gerados e faça download

### 🎵 Publicando no TikTok

**Workflow simplificado para upload:**

1. Processe um vídeo normalmente
2. Clique em **"📂 Abrir Pasta de Clipes"** ou **"🎵 Preparar para TikTok"**
3. Sistema organiza automaticamente:
   - ✅ Vídeos com nomes amigáveis (`01_momento_viral.mp4`)
   - ✅ Capas correspondentes (`01_momento_viral_capa.jpg`)
   - ✅ Arquivo `DESCRICOES.txt` com todas as descrições prontas
   - ✅ Arquivo `LEIA-ME.txt` com instruções completas de upload
4. Pasta abre automaticamente com tudo organizado
5. Transfira para celular (USB/Drive/AirDrop)
6. Publique no TikTok (~30 segundos por vídeo)

**Tempo total:** ~10 minutos para 10 vídeos 🚀

**Documentação completa**: [MANUAL_UPLOAD_GUIDE.md](MANUAL_UPLOAD_GUIDE.md)

## Estrutura do Projeto

```
cortes-video/
├── public/              # Frontend
│   ├── index.html      # Interface web
│   ├── style.css       # Estilos
│   └── script.js       # Lógica do frontend
├── downloads/          # Clipes gerados (criado automaticamente)
├── temp/               # Arquivos temporários (criado automaticamente)
├── server.js           # Servidor backend
├── package.json        # Dependências
└── README.md          # Este arquivo
```

## API Endpoints

### POST /api/process-video
Inicia o processamento de um vídeo do YouTube.

**Body:**
```json
{
  "videoUrl": "https://www.youtube.com/watch?v=..."
}
```

**Resposta:**
```json
{
  "jobId": "uuid-do-job",
  "message": "Processamento iniciado"
}
```

### GET /api/job/:jobId
Verifica o status de um job de processamento.

**Resposta (em processamento):**
```json
{
  "status": "processing",
  "clips": [],
  "error": null
}
```

**Resposta (concluído):**
```json
{
  "status": "completed",
  "clips": [
    {
      "name": "clip_001.mp4",
      "url": "/downloads/jobId/clip_001.mp4",
      "number": 1
    },
    {
      "name": "clip_002.mp4",
      "url": "/downloads/jobId/clip_002.mp4",
      "number": 2
    }
  ],
  "error": null
}
```

## Observações

- Os vídeos são baixados na melhor qualidade disponível
- Cada clipe tem duração de 1 minuto (60 segundos)
- O último clipe pode ter menos de 1 minuto se o vídeo não for divisível por 60
- Os clipes são retornados em ordem crescente (do primeiro ao último)
- Os arquivos são salvos na pasta `downloads` dentro de subpastas por job
- **Capas inteligentes**: As capas são geradas com DALL-E 3 usando a descrição do clipe para criar imagens relevantes e atraentes
- Se a geração com DALL-E falhar (por exemplo, falta de créditos), o sistema usa gradientes coloridos como fallback
- Cada clipe inclui legendas embutidas no vídeo

## Troubleshooting

### Erro ao baixar vídeo
- Verifique se o link do YouTube é válido
- Certifique-se de que o yt-dlp está instalado: `yt-dlp --version`
- Alguns vídeos podem ter restrições de download
- Mantenha o yt-dlp atualizado: `yt-dlp -U` ou `pip install -U yt-dlp`

### Erro de FFmpeg
- Certifique-se de que o FFmpeg está instalado corretamente: `ffmpeg -version`
- Verifique se o FFmpeg está no PATH do sistema

### Erro "yt-dlp: command not found"
- No Windows: instale usando `winget install yt-dlp` ou baixe o executável
- No Linux/Mac: instale usando o gerenciador de pacotes ou pip
- Após instalar, reinicie o terminal e verifique com `yt-dlp --version`

### Porta 3000 em uso
Altere a porta no arquivo `server.js`:
```javascript
const PORT = 3000; // Mude para outra porta
```

## Tecnologias Utilizadas

- **Backend:**
  - Node.js
  - Express.js
  - yt-dlp (download de vídeos do YouTube)
  - fluent-ffmpeg (processamento de vídeo)
  - OpenAI API (Whisper para transcrição, GPT-4 para descrições, DALL-E 3 para capas)
  - node-canvas (geração de imagens)
  - node-fetch (download de imagens geradas)

- **Frontend:**
  - HTML5
  - CSS3
  - JavaScript (Vanilla)

## Como Funcionam as Capas Inteligentes

O sistema implementa um processo avançado de geração de capas:

1. **Análise do Conteúdo**: Para cada clipe, o GPT-4 analisa a transcrição e cria um prompt descritivo
2. **Geração com DALL-E 3**: O prompt é enviado para o DALL-E 3 que gera uma imagem personalizada relacionada ao conteúdo do clipe
3. **Composição da Capa**: A imagem gerada é usada como fundo, com overlay para melhorar a legibilidade do texto
4. **Textos Sobrepostos**: O título do clipe e o nome do canal são adicionados sobre a imagem
5. **Fallback Inteligente**: Se houver qualquer erro, o sistema usa gradientes coloridos automaticamente

### Exemplo de Prompt Gerado

Se o clipe fala sobre "investimentos em ações", o sistema pode gerar um prompt como:
```
Stock market charts with upward trending graphs, financial growth concept,
vibrant blue and green colors, high quality, professional photography, digital art
```

Isso resulta em uma capa visualmente atraente e contextualmente relevante ao conteúdo do vídeo!

## Licença

ISC
