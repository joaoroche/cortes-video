# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YouTube video clipper - Downloads YouTube videos and automatically creates short clips with embedded subtitles, AI-generated covers, and TikTok descriptions. Supports three processing modes:
- **Sequential**: Fixed 1-minute clips
- **Intelligent**: AI-detected viral moments (60±15s)
- **Curiosity**: Complete curiosities with variable duration (20s-4min)

## Commands

```bash
# Install dependencies
npm install

# Start server (production)
npm start

# Start server with hot-reload (development)
npm run dev
```

Server runs at http://localhost:3000

## Architecture

```
server.js          → Entry point, initializes FFmpeg and directories
src/app.js         → Express app setup, routes definition
src/config/        → Configuration (env vars, FFmpeg settings)
src/controllers/   → Request handlers (videoController)
src/services/      → Business logic layer
src/middlewares/   → Express middlewares (cors, body-parser, static files)
src/utils/         → Validators and formatters
public/            → Frontend (vanilla HTML/CSS/JS)
```

### Service Layer

- **videoService** - YouTube download (yt-dlp), audio extraction, silence detection (FFmpeg)
- **transcriptionService** - Whisper transcription, SRT generation, topic analysis (GPT-4)
- **clipService** - Calculate cut points, create video clips with embedded subtitles
- **coverService** - Generate covers (DALL-E 3 or gradient fallback) and TikTok descriptions
- **intelligentAnalysisService** - AI-powered viral content detection for intelligent mode
- **curiositiesAnalysisService** - AI-powered complete curiosity detection with variable duration
- **youtubeSubtitlesService** - Fetch YouTube auto-captions (saves Whisper API costs)
- **channelProfileService** - Learn channel patterns over time for better recommendations
- **jobService** - In-memory job tracking with status/progress updates

### Processing Flow

**Sequential Mode:**
1. Download video via yt-dlp
2. Try fetching YouTube subtitles (free) → fallback to Whisper transcription
3. Generate SRT file, detect silences, analyze topic changes
4. Calculate smart cut points based on silence + topic analysis
5. Create clips in batches with embedded subtitles
6. Generate covers (DALL-E or gradients) and TikTok descriptions in parallel

**Intelligent Mode:**
1. Download and transcribe video
2. AI analyzes transcription to identify viral moments (GPT-4o)
3. Creates clips at detected viral moments (60±15s)
4. Generates covers and optimized TikTok descriptions

**Curiosity Mode (NEW):**
1. Download and transcribe video
2. AI identifies complete curiosity blocks with beginning, development, and conclusion (GPT-4o)
3. Variable duration (20s-4min) - duration adapts to ensure story completeness
4. Each clip scores for completeness (0-10) and virality (0-10)
5. Only creates clips with completeness_score >= 7 (configurable)
6. Natural boundaries aligned with sentence endings

## API Endpoints

- `POST /api/process-video` - Start video processing
  - Body: `{videoUrl, processingType?, intelligentSettings?, curiositySettings?, subtitleStyle?}`
  - `processingType`: 'sequential', 'intelligent', or 'curiosity'
  - `curiositySettings`: `{minDuration, maxDuration, idealDuration, priority, maxBlocks}`
- `GET /api/job/:jobId` - Check job status and get clips
- `GET /api/channels` - List known channel profiles
- `GET /api/channels/:channelId` - Get channel profile details
- `DELETE /api/channels/:channelId` - Delete channel profile

## External Dependencies

- **yt-dlp** - Must be installed system-wide or place `yt-dlp.exe` in project root
- **FFmpeg** - Must be in PATH or place binaries in `ffmpeg-bin/` folder
- **OpenAI API** - Required for transcription (Whisper), descriptions (GPT-4), covers (DALL-E 3)

## Environment Variables

Key configuration in `.env`:
- `OPENAI_API_KEY` - Required
- `BATCH_SIZE` - Parallel clip encoding (default: 2, increase for faster processing with more RAM)
- `AUDIO_QUALITY` - Audio bitrate for Whisper (default: 64kbps)
- `USE_DALLE_COVERS` - Enable DALL-E covers (default: true, set to false for speed)
- `OPENAI_PARALLEL_REQUESTS` - Concurrent API calls (default: 5)

### Curiosity Mode Configuration (Optional)
- `CURIOSITY_MIN_DURATION` - Minimum clip duration in seconds (default: 20)
- `CURIOSITY_MAX_DURATION` - Maximum clip duration in seconds (default: 240)
- `CURIOSITY_IDEAL_DURATION` - Ideal clip duration in seconds (default: 90)
- `CURIOSITY_MIN_COMPLETENESS_SCORE` - Minimum score to include clip (default: 7)
- `CURIOSITY_DEFAULT_MAX_BLOCKS` - Maximum number of curiosities to extract (default: 10)

## Processing Modes Comparison

| Feature | Sequential | Intelligent | Curiosity |
|---------|-----------|------------|-----------|
| **Duration** | Fixed 60s | 60±15s | Variable 20s-4min |
| **AI Analysis** | No | Yes (viral detection) | Yes (semantic blocks) |
| **Best For** | Splitting long content | Viral clips for social media | Complete stories/curiosities |
| **Cut Logic** | Time + silence + topics | Viral moments | Complete narratives |
| **Completeness** | N/A | Partial | Full (beginning→end) |
| **Cost** | Low | Medium | Medium-High |

## GPU Acceleration

FFmpeg automatically detects and uses GPU encoding when available (NVIDIA NVENC, Intel QuickSync, AMD AMF, Apple VideoToolbox). No configuration needed.
