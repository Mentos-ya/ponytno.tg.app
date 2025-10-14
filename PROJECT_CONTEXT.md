# PROJECT_CONTEXT.md - AI Agent Instructions

## CRITICAL RULE - READ FIRST

**YOU MUST NOT modify or delete this file (`PROJECT_CONTEXT.md`) without explicit user permission.**

This is an absolute rule. Never suggest changes to this file. Never edit this file unless the user explicitly commands you to do so.

---

## Project Overview

**Name**: Понятно MiniApp TG  
**Type**: Telegram Mini App for OCR menu recognition  
**Stack**: React 19 + TypeScript + Vite + Tesseract.js  
**Purpose**: Photo OCR with smart classification (titles/prices/descriptions) and visual highlighting

---

## Critical Files - DO NOT BREAK

### 1. `index.html` - Error Filtering Script
**Location**: `/index.html`  
**Critical Section**: Lines with error filtering script  
**Purpose**: Filters Cursor BrowserAutomation errors (`postMessage`, `DOMWindow`, `vscode-file://`)

**NEVER**:
- Remove the error filtering `<script>` tag
- Modify console.error/warn overrides
- Delete comments explaining the filtering

**Why Critical**: Without this, console is flooded with Cursor system errors that break debugging.

### 2. `src/App.tsx` - Logging Function
**Location**: `/src/App.tsx`  
**Critical Function**: `sendToLogServer`  
**Purpose**: Sends logs to localhost:3030 in development

**NEVER**:
- Change the port from 3030
- Remove the `isDevelopment` check
- Modify the log endpoint URL structure

**Why Critical**: This is the single source of truth for debugging. Logs are written to `logs/log-server-*.log`.

### 3. `src/App.tsx` - drawHighlights Function
**Location**: `/src/App.tsx`  
**Critical Function**: `drawHighlights(words: Word[])`  
**Purpose**: Renders OCR highlighting on canvas overlay

**NEVER**:
- Remove devicePixelRatio calculations
- Change z-index or canvas layering
- Break the ResizeObserver logic
- Remove the `isDrawing` flag

**Why Critical**: This function handles complex rendering with DPR, grouping words into lines, and preventing infinite loops.

### 4. `log-server.cjs` - Log Server
**Location**: `/log-server.cjs`  
**Port**: 3030 (hardcoded)  
**Purpose**: Local logging server for development

**NEVER**:
- Change the port number
- Remove SPA fallback logic
- Modify CORS settings

**Why Critical**: Tightly integrated with App.tsx logging. Port 3030 is referenced in multiple places.

### 5. `log-server.cjs` - YandexGPT Prompt
**Location**: `/log-server.cjs` - `analyzeWithYandexGPT` function  
**Critical Section**: Prompt for menu structure classification  
**Purpose**: Defines how AI classifies text into categories

**NEVER**:
- Remove rules about multi-line titles
- Delete "Golden Rule" about menu block structure
- Change category names (title/description/price/price_modifier)
- Modify examples without testing

**Why Critical**: Prompt determines classification quality. Changes affect all menu recognition accuracy.

---

## Architecture

### File Structure
```
src/
├── App.tsx          # Main component with OCR logic
├── main.tsx         # Entry point
├── App.css          # Styles
└── index.css        # Global styles

index.html           # HTML with error filtering
log-server.cjs       # Local log server (port 3030)
api/log.js           # Vercel API for logs

tests/
├── ocr-highlight.spec.ts  # E2E tests
└── fixtures/              # Test images
```

### Technology Stack
- React 19 + TypeScript + Vite
- Yandex Vision API (OCR engine - распознавание текста)
- YandexGPT API (AI классификация структуры меню)
- Tesseract.js v5 (резервный OCR, не используется активно)
- @twa-dev/sdk (Telegram integration)
- Playwright (E2E testing)
- Node.js log server (local development)

### Data Flow
1. User uploads image (camera or gallery)
2. **Stage 1 - Yandex Vision OCR**: Image → text recognition with coordinates
3. **Stage 2 - YandexGPT Classification**: Words grouped into lines → AI classifies menu structure
4. **Stage 3 - Menu Grouping**: Positions grouped into blocks (price_modifier + title + price + description)
5. **Stage 4 - Rendering**: 
   - Gray borders around menu positions
   - Colored highlights for each category
   - Modal window on title click
6. All steps logged to localhost:3030/log with token usage and cost

---

## Core Functionality

### OCR Processing
**Engine**: Tesseract.js  
**Languages**: `eng+rus` (default)  
**Fallback Chain**: If `words` array is empty, use `lines` → `paragraphs` → `blocks`

**Critical Parameters**:
- `bbox`: Bounding box coordinates {x0, y0, x1, y1}
- `text`: Recognized text content
- `confidence`: Recognition confidence (0-100)

### Text Classification
**Categories** (4 types):
- `price_modifier`: Size variants (e.g., "DOUBLE", "TRIPLE") → Blue highlight
- `title`: Dish names (e.g., "CHEESEBURGER", multi-line titles) → Pink/red highlight
- `price`: Numeric values only (e.g., "930", "1190") → Green highlight
- `description`: Ingredients/descriptions (e.g., "eggs, cheese, tomatoes") → Yellow highlight

**Classification Method**: YandexGPT with context-aware prompt (size, coordinates, text structure)

**Multi-line Titles**: Titles can span 2-3 lines. AI groups them based on:
- Font size similarity
- Capital letters
- No commas
- Spatial proximity

**Classification Logic Location**: `log-server.cjs` - `analyzeWithYandexGPT` function

### Canvas Overlay Rendering
**Layer**: Canvas with z-index: 2 (above image)  
**DPR Handling**: MUST multiply coordinates by `window.devicePixelRatio`  
**Trigger Events**: 
- Image onLoad
- ResizeObserver detects size change
- OCR results change (lastWords state)

**Anti-Pattern**: Infinite re-render loops. Use `isDrawing` flag and dimension change detection.

---

## Yandex API Integration

### Environment Variables
**Location**: `.env.local` (NOT in git)  
**Required**:
- `VITE_YANDEX_VISION_API_KEY` - Yandex Vision OCR API key
- `VITE_YANDEX_GPT_API_KEY` - YandexGPT API key
- `VITE_YANDEX_FOLDER_ID` - Yandex Cloud folder ID

**NEVER commit these to git!**

### Two-Stage OCR Process

**Stage 1: Yandex Vision OCR**
- Endpoint: `/api/analyze-image-gpt` (proxied through log-server.cjs)
- Input: Base64 image
- Output: Words with bounding boxes {x0, y0, x1, y1, text}
- Cost: ~0.13₽ per image

**Stage 2: YandexGPT Classification**
- Input: Lines of text with Y-coordinates and font sizes
- Prompt: ~2000 tokens (menu structure analysis instructions)
- Output: JSON array [{"line": 1, "category": "title"}, ...]
- Cost: ~0.20₽ per 1000 tokens (~0.40₽ per scan)

**Total Cost per Scan**: ~0.53₽ (Vision + GPT)

### Token Logging
**Location**: `log-server.cjs` - `analyzeWithYandexGPT` function  
**Logs**:
```
💰 Использование токенов YandexGPT:
   Input tokens: 2507
   Output tokens: 150
   Total tokens: 2657
   📊 Примерная стоимость GPT: ~0.3986₽
```

**Billing**: Check official data at https://console.yandex.cloud/billing

---

## Menu Item Grouping & Modal Window

### Gray Borders (Menu Position Grouping)
**Purpose**: Visual grouping of menu positions on image  
**Logic**: `groupMenuItems()` function in `src/App.tsx`

**Grouping Rules**:
1. New position starts when:
   - `price_modifier` appears (DOUBLE, TRIPLE)
   - OR new `title` after previous `description`
2. Position ends when next position starts

**Visual**: Gray border (2px, rgba(128, 128, 128, 0.8)) around each position

### Modal Window
**Trigger**: Click on any `title` word  
**Content**:
- Full title (all title words from gray border group)
- Price modifier (if exists)
- All prices from the group
- Full description (until next title/price_modifier)

**Size**: iPhone-like aspect ratio (9/16), 280px width, max 520px height  
**Close**: Click outside modal or "Закрыть" button

**State**: `menuItems` - array of grouped positions  
**Function**: `handleCanvasClick()` - detects click and shows modal

---

## Project Rules for AI Agents

### Privacy and Data Handling
**MUST**:
- Never save photos to localStorage/IndexedDB
- Never send photos to server (except Tesseract.js local processing)
- Playwright tests MUST NOT save videos/screenshots by default

**NEVER**:
- Store images in any persistent storage
- Upload images to external APIs without explicit user consent

### UX and Permissions
**MUST**:
- Request camera access ONLY when user clicks camera button
- Use system file picker for gallery (no `capture` attribute)
- Show ONLY highlighted overlay on image (no separate text output)

**NEVER**:
- Request permissions on app load
- Auto-trigger camera without user action

### Testing and Deployment
**Before Deploy - MUST**:
1. Run `npm run test:e2e`
2. At least mock test MUST pass
3. Check that overlay rendering works

**Test Modes**:
- `?mockOcr=1` - Mock OCR with fixed bbox (deterministic tests)
- `?test=1` - Expose `window.__overlayDebug` and `data-*` attributes
- `?debug=1` - Show debug UI with word count and image dimensions

### Code Modification Rules
**BEFORE making changes**:
1. Read relevant code sections completely
2. Check if it's in "Critical Files" list above
3. Test locally on http://localhost:3030
4. Verify logs show expected behavior
5. Run E2E tests

**WHEN making changes**:
1. Keep existing comments with "НЕ УДАЛЯТЬ!", "НЕ МЕНЯТЬ!", "КРИТИЧНО"
2. Add your own comments explaining WHY (not just WHAT)
3. Preserve error handling and logging
4. Test with real images from `tests/fixtures/`

**NEVER**:
- Delete code without understanding its purpose
- Remove comments that warn about critical sections
- Change ports, URLs, or hardcoded values without checking all references
- Modify `PROJECT_CONTEXT.md` (this file) without explicit user command

---

## Common Problems and Solutions

### Problem: "No highlight after OCR"
**Diagnostic Checklist**:
1. Check `wordsCount` in logs or `data-words-count` attribute (enable `?test=1`)
2. If `wordsCount === 0`:
   - Try different test image with better contrast
   - Check Tesseract.js console logs for errors
   - Verify language setting (`eng+rus`)
3. If `wordsCount > 0` but no visual boxes:
   - Check canvas dimensions match image dimensions
   - Verify devicePixelRatio is applied correctly
   - Check z-index and opacity of overlay canvas
   - Inspect canvas context - are rectangles being drawn?

**Solution Location**: `src/App.tsx` - `drawHighlights` function

### Problem: "Cursor preload-browser.js errors"
**Symptom**: Console flooded with `Failed to execute 'postMessage'` errors  
**Cause**: Cursor BrowserAutomation system errors  
**Solution**: Error filtering script in `index.html` (NEVER REMOVE)  
**Alternative**: Test in Yandex Browser instead of Cursor's embedded browser

### Problem: "Infinite drawHighlights loops"
**Symptom**: Logs show repeated "drawHighlights ВЫЗВАНА" messages  
**Cause**: ResizeObserver or state change triggers re-render which triggers redraw  
**Solution**: `isDrawing` flag and dimension change detection in useEffect  
**Code Location**: `src/App.tsx` - useEffect with imageDims/lastWords dependencies

### Problem: "Telegram.WebApp method not supported"
**Symptom**: Console warning about unsupported Telegram method  
**Cause**: Some Telegram versions don't support all WebApp API methods  
**Status**: EXPECTED BEHAVIOR - app handles this gracefully  
**Action**: IGNORE - functionality works without these methods

---

## Commands Reference

### Local Development
```bash
# Start log server (port 3030)
pkill -f log-server.cjs
node log-server.cjs > logs/log-server-$(date +%Y%m%d-%H%M%S).log 2>&1 &

# Start dev server (port 5173)
npm run dev

# Check logs
tail -f logs/log-server-*.log

# Check project status
bash check-status.sh
```

### Testing and Debugging
```bash
# Run E2E tests
npm run test:e2e

# Check API endpoints
npm run check-api

# View recent logs with timestamps
tail -100 logs/log-server-*.log | grep '\['
```

### Cost Analysis
```bash
# Check token usage in recent logs
grep -A 5 "💰 Использование токенов" logs/log-server-*.log

# Calculate total scans today
grep -c "Total tokens:" logs/log-server-$(date +%Y%m%d)-*.log

# View billing in Yandex Cloud
# https://console.yandex.cloud/billing
```

### Build and Deploy
```bash
# Build only (no deploy)
npm run build:only

# Build + preview deploy
npm run build:preview

# Production deploy (ONLY if user explicitly requests)
npm run deploy:prod
```

---

## URLs

- Local dev server: http://localhost:5173
- Local log server: http://localhost:3030
- Preview: https://ponyatno-miniapp-preview.vercel.app
- Production: https://ponyatno-miniapp-tg.vercel.app

---

## AI Agent Workflow

### On Chat Start
1. Read this entire file (PROJECT_CONTEXT.md)
2. Check git status: `git status`
3. Check if log server running: `lsof -i :3030`
4. Check recent logs: `tail -20 logs/log-server-*.log`
5. Understand current state before suggesting any changes

### Before Code Changes
1. Identify which files need modification
2. Check if any are in "Critical Files" section
3. Read the full file content first
4. Plan changes mentally, considering impact on:
   - Logging system
   - Canvas rendering
   - OCR processing
   - Error handling
5. Make changes preserving critical logic

### After Code Changes
1. Test on http://localhost:3030 with real image
2. Check logs for errors: `tail -30 logs/log-server-*.log`
3. Verify overlay renders correctly
4. Run tests: `npm run test:e2e`
5. Report results to user concisely

### When User Reports Bug
1. Ask for reproduction steps
2. Check recent logs first
3. Check if issue matches "Common Problems" section
4. If not, investigate systematically:
   - Console errors?
   - Network errors?
   - OCR not running?
   - Canvas not rendering?
5. Propose specific fix with file/line references

---

## State and Context Tracking

### What to Monitor
- **Log server status**: Port 3030 must be running
- **Git changes**: Track modified files
- **Recent logs**: Last 20-50 lines show recent activity
- **Test results**: Mock test MUST pass before deploy

### What to Track in Conversation
- Which files you've modified in current session
- Whether tests have been run after changes
- If user has tested changes in browser
- Any errors encountered and if resolved

---

## Final Checklist Before Proposing Changes

- [ ] I have read the relevant code sections completely
- [ ] This change does NOT modify critical sections without user approval
- [ ] I understand WHY the existing code is structured this way
- [ ] I have a plan to test the changes locally
- [ ] I will check logs after making changes
- [ ] I will NOT modify `PROJECT_CONTEXT.md` unless explicitly asked
- [ ] I will preserve all warning comments in code

---

**Last Updated**: 2025-10-15  
**Version**: 2.1.0 (AI Agent Format + Yandex API Integration)  
**Status**: Production - Log server running on port 3030
