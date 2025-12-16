# LinkedIn CRM Sync - Chrome Extension

A Chrome extension that bulk imports your LinkedIn connections into your CRM.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (check with `node --version`)
- **npm** 9+ or **pnpm** (recommended)
- **Chrome** browser

### Installation

```bash
# Navigate to extension directory
cd linkedin-chrome-extension

# Install dependencies
npm install

# Build the extension
npm run build

# For development with hot reload
npm run dev
```

### Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `dist/` folder from this project
5. The extension icon should appear in your toolbar! 🎉

### Testing the Extension

1. Click the extension icon in Chrome toolbar
2. Sign in with your CRM account (or use test mode)
3. Click "Start Sync"
4. Navigate to LinkedIn connections page when prompted
5. Watch your connections import!

---

## 📁 Project Structure

```
linkedin-chrome-extension/
├── src/
│   ├── background/           # Background service worker
│   │   ├── index.ts         # Main background script
│   │   ├── message-handler.ts
│   │   └── sync-scheduler.ts
│   │
│   ├── content/             # Content scripts (injected into pages)
│   │   ├── connections-scraper.ts
│   │   ├── profile-scraper.ts
│   │   └── sidebar.ts
│   │
│   ├── popup/               # Extension popup (React)
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   └── styles/
│   │
│   ├── lib/                 # Shared utilities
│   │   ├── api-client.ts
│   │   ├── storage.ts
│   │   ├── rate-limiter.ts
│   │   ├── dom-utils.ts
│   │   └── logger.ts
│   │
│   ├── config/              # Configuration
│   │   ├── selectors.ts     # LinkedIn DOM selectors
│   │   └── constants.ts
│   │
│   └── types/               # TypeScript types
│       └── index.ts
│
├── public/
│   ├── manifest.json        # Chrome extension manifest
│   └── icons/               # Extension icons
│
├── dist/                    # Built extension (git-ignored)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

---

## 🛠️ Development

### Available Scripts

```bash
# Development build with watch mode
npm run dev

# Production build
npm run build

# Type checking
npm run typecheck

# Linting
npm run lint

# Run tests
npm run test
```

### Development Workflow

1. **Start dev mode:**
   ```bash
   npm run dev
   ```

2. **Load extension in Chrome:**
   - Go to `chrome://extensions/`
   - Click "Load unpacked" → select `dist/` folder

3. **Make changes:**
   - Edit files in `src/`
   - Vite will rebuild automatically

4. **Reload extension:**
   - Go to `chrome://extensions/`
   - Click the refresh icon on your extension
   - Or press `Cmd+R` on the extension popup

### Debugging Tips

#### Background Script
1. Go to `chrome://extensions/`
2. Find your extension
3. Click "Service Worker" link (under "Inspect views")
4. Opens DevTools for background script

#### Content Scripts
1. Right-click on LinkedIn page
2. Click "Inspect"
3. Go to "Sources" tab
4. Find your content script under "Content scripts"

#### Popup
1. Right-click extension icon
2. Click "Inspect popup"
3. Opens DevTools for popup

### Console Logging

All logs are prefixed with `[CRM-Extension]` for easy filtering:

```javascript
// In browser console, filter by:
[CRM-Extension]
```

---

## 🧪 Testing

### Manual Testing Checklist

#### Setup
- [ ] Extension loads without errors
- [ ] Popup opens correctly
- [ ] Can authenticate with backend

#### Bulk Sync
- [ ] Navigates to LinkedIn connections page
- [ ] Progress bar updates correctly
- [ ] Contacts sent to backend in batches
- [ ] Handles 500+ connections
- [ ] Shows completion message

#### Quick Add
- [ ] Sidebar appears on profile pages
- [ ] Shows "Add to CRM" button
- [ ] Contact created successfully
- [ ] Shows "Already in CRM" for existing contacts

#### Error Handling
- [ ] Shows error if not logged in to LinkedIn
- [ ] Handles network errors gracefully
- [ ] Rate limiting works correctly

### Automated Tests

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

---

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root:

```env
# Backend API URL
VITE_API_URL=https://api.yourcrm.com

# For local development
VITE_API_URL=http://localhost:3000

# Sentry DSN (optional, for error tracking)
VITE_SENTRY_DSN=
```

### LinkedIn Selectors

If LinkedIn updates their DOM, update selectors in `src/config/selectors.ts`:

```typescript
export const SELECTORS = {
  connectionCard: '.mn-connection-card',
  connectionName: '.mn-connection-card__name',
  // ... update if LinkedIn changes
};
```

---

## 📦 Building for Production

### Build Steps

```bash
# 1. Update version in manifest.json
# 2. Build production bundle
npm run build

# 3. The dist/ folder is ready to upload
```

### Chrome Web Store Submission

1. **Create ZIP file:**
   ```bash
   cd dist
   zip -r ../linkedin-crm-extension.zip .
   ```

2. **Upload to Chrome Web Store:**
   - Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Click "New Item"
   - Upload the ZIP file
   - Fill in store listing details
   - Submit for review

### Store Listing Requirements

- [ ] 5 screenshots (1280x800)
- [ ] Promotional tile (440x280)
- [ ] Privacy policy URL
- [ ] Detailed description

---

## 🔒 Security & Privacy

### Permissions Used

| Permission | Reason |
|------------|--------|
| `storage` | Store auth tokens and sync state |
| `notifications` | Notify on sync complete/errors |
| `alarms` | Schedule daily incremental sync |
| `tabs` | Open LinkedIn connections page |
| `scripting` | Inject content scripts |

### Data Handling

- All data sent over HTTPS
- Auth tokens stored in `chrome.storage.local`
- No data sold or shared with third parties
- Users can delete all data anytime

---

## 🐛 Troubleshooting

### Extension Won't Load

**Error:** "Manifest file is missing or unreadable"
- Make sure you selected the `dist/` folder, not the project root
- Run `npm run build` first

**Error:** "Service worker registration failed"
- Check for syntax errors in background script
- Open DevTools for service worker to see errors

### Scraping Not Working

**Issue:** No connections found
- LinkedIn may have updated their DOM
- Check console for selector errors
- Update selectors in `src/config/selectors.ts`

**Issue:** Rate limited by LinkedIn
- Wait 1 hour before trying again
- Reduce rate limits in `src/lib/rate-limiter.ts`

### Auth Issues

**Issue:** "Not authenticated"
- Clear extension storage: `chrome.storage.local.clear()`
- Re-authenticate

### Network Errors

**Issue:** Backend unreachable
- Check `VITE_API_URL` in `.env`
- Ensure backend is running
- Check CORS settings on backend

---

## 📝 Changelog

### v1.0.0 (Initial Release)
- Bulk LinkedIn connections import
- Quick add from profile pages
- Progress tracking UI
- Rate limiting
- Error handling

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

MIT License - see LICENSE file for details.

---

## 🆘 Support

- **Issues:** Open a GitHub issue
- **Email:** support@yourcrm.com
- **Docs:** https://docs.yourcrm.com/linkedin-sync

