# Publishing to Figma Community

Everything the publish form asks for is below, ready to paste. Images are in `assets/`.

## Before you start

1. **Two-factor authentication:** Figma requires 2FA on your account to publish (Settings → Security).
2. **Test in Figma desktop.** Import with Plugins → Development → Import plugin from manifest, and check:
   - [ ] One frame from English to Hindi: the copy appears on the right, named `… — Hindi (hi)`, and the text is in Noto Sans Devanagari.
   - [ ] A frame with a component instance: the instance stays attached and its text is translated.
   - [ ] Text with `{{name}}` and a glossary term: both come out unchanged.
   - [ ] Run the same frame again: the report shows strings "from cache" and 0 chars sent.
   - [ ] English to Arabic: left-aligned text becomes right-aligned.
   - [ ] Close and reopen the plugin: the languages are remembered.
3. **The plugin ID** (`1699370917156037806`) is already set in `manifest.json`.

## Steps in Figma desktop

1. Open any design file. Go to **Plugins → Development → Manage plugins in development**.
2. Find **Free Screen Translator**, open its **⋯** menu and choose **Publish**.
3. Fill in the form using the copy below. Upload `assets/icon-128.png` as the icon and `assets/cover-1920x1080.png` as the cover.
4. Answer the network-access and data-security questions (see below), then **Submit for review**.
   Figma reviews new plugins before they go live and emails you the result.
5. For later updates: rebuild, then **Publish → Publish new version**, with a short note on what changed.

## Listing copy

**Name**
Free Screen Translator

**Tagline**
Duplicate any frame and translate every text layer into 40+ languages. Free, no account.

**Description**

> Select one or more frames, pick a From and To language, and click Translate. A copy of each frame
> appears next to the original with all of its text translated. Your original is never touched.
>
> **Free, no signup.** Translation uses the free MyMemory API: 5,000 characters a day, or
> 50,000 if you add an email in the plugin. That's about 15–30 screens a day. Repeated strings are
> translated only once and cached, so rerunning a screen or reusing components costs nothing.
> Prefer your own server? Point it at a self-hosted LibreTranslate.
>
> **Made for real UI files**
> • Component instances keep working: text is overridden, never detached
> • Hindi, Japanese, Chinese, Korean, Arabic, Thai and more switch to a matching Noto font, keeping the weight
> • Arabic, Persian, Urdu and Hebrew are right-aligned
> • Placeholders like {{name}}, URLs, emails and your own "don't translate" terms stay untouched
> • Numbers and symbols are skipped
> • Hidden layers can be skipped
> • Text that overflows a fixed-size box is flagged, with an optional switch to auto-height
> • If you hit the daily limit, finished text is kept and the copy is marked "partial". Run it again later to finish.
>
> Your languages and options are remembered between runs.
>
> Machine translation is a starting point. Have a native speaker review copy before you ship.

**Category:** Design tools (or Localization, if it's offered).

**Tags** (up to 12)
translate, translation, localization, i18n, l10n, language, multilingual, hindi, rtl, arabic, japanese, copy

**Support contact:** your email or a GitHub issues link.

## Network access and data disclosure

The manifest already declares the only domain the plugin calls:

- `https://api.mymemory.translated.net`: the text of the selected layers is sent there to be translated.
  The optional email is sent with each request (MyMemory's `de` parameter) to raise the daily limit.
- `http://localhost:5000` is listed only under `devAllowedDomains`, so it's for development and isn't used by the published version.

For the data-security questions:
- The plugin has no server of its own and collects no analytics.
- Settings, the translation cache and the daily usage counter are stored only in `figma.clientStorage` on the user's device.
- Layer text is sent to MyMemory, a third party, so say this wherever the form asks whether data is sent outside Figma.

## If you want LibreTranslate users on the published version

The published plugin can only reach domains listed in the manifest. To support a public or team
LibreTranslate server, add its origin to `networkAccess.allowedDomains` (for example
`https://translate.yourteam.com`) before publishing, and mention it in the description.
