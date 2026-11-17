# Acceptance on a real phone

I6 owns this file and adds the guided feature checklist. The section below comes from I4. It lists
what the browser tests cannot show. Chromium at 390 x 844 in `pnpm e2e` and `pnpm e2e:offline`
covers layout, offline use, sync, updates and storage. It does not cover how iOS Safari and an
installed web app behave.

Use an iPhone on a current iOS. Run each check once in Safari. Run it again in the installed app
when the check says so. Tick a box only when everything in its line holds. Write any failure under
"Findings", with the screen, the iOS version, and a screenshot or a screen recording.

## iPhone checks (I4)

### Install hint and installing
- [ ] Open the app in Safari (not installed). The one time hint for Add to Home Screen appears on
      Today. It explains how to add the app to the home screen. It does not cover the tab bar or
      the first card.
- [ ] Dismiss the hint, reload, and open Today again. The hint does not come back.
- [ ] In Chrome or Firefox on the same iPhone, no hint appears.
- [ ] Add to Home Screen. The icon and the name "Slovak" are right, and the icon has no white
      border.
- [ ] The installed app opens without Safari's address bar and shows the Today screen.
- [ ] The installed app asks you to sign in once more, because it keeps its own storage. After you
      sign in, the hint never shows inside the installed app.

### Safe areas (installed app, portrait)
- [ ] On every tab screen, the title starts below the status bar and the notch or Dynamic Island,
      and nothing sits under the clock.
- [ ] The tab bar sits above the home indicator. Each of the five tabs reacts to a tap along its
      whole height.
- [ ] On the review screen, the rating buttons and the accent bar stay clear of the home
      indicator.
- [ ] On a long list (Deck, Library, a word band), the last row scrolls fully into view above the
      tab bar.
- [ ] Bottom sheets (a word in the reader, Edit note, Report a problem) keep their buttons above
      the home indicator. A swipe down closes them.
- [ ] Dark mode (iOS setting, and the app's own theme in Settings). The status bar text stays
      readable on both themes.

### Keyboard and the accent bar
- [ ] Review: tap the answer field. The keyboard opens, and the accent bar (á ä č ď é í ĺ ľ ň ó ô
      ŕ š ť ú ý ž) sits directly above the keyboard, not under it and not at the bottom of the
      page.
- [ ] The prompt sentence stays visible while you type. The page does not jump when the keyboard
      opens or closes.
- [ ] A tap on a letter in the accent bar inserts it at the cursor and keeps the keyboard open,
      with no blur and refocus flicker.
- [ ] The answer field shows no autocorrect suggestions, does not capitalise the first letter, and
      does not underline Slovak words as misspelled.
- [ ] Return on the keyboard checks the answer. Return again accepts the default rating.
- [ ] The same holds for the trainer's gap field and for the tutor's message field.
- [ ] With the iOS Slovak keyboard added, long press works as usual, and the accent bar still
      shows.

### Zoom on input fields
- [ ] Tap into every text field: sign in (email, password), the code field, onboarding (name, time
      zone), review answer, trainer gap, import (title, text), deck search, tutor message. The
      page does not zoom in. Text in the fields is at least 16 px.
- [ ] Pinch zoom on a reader text still works (accessibility), and the layout comes back to full
      width afterwards.
- [ ] The code field offers the code from Mail or Messages above the keyboard (one-time code
      autofill).

### Offline, sync and storage on the phone
- [ ] Installed app, flight mode on: open the app from the home screen. It starts, shows the
      offline notice, and Review, the trainer, opened texts and word sorting work.
- [ ] Answer ten reviews in flight mode. Turn flight mode off and bring the app to the foreground.
      The answers are sent within a few seconds, and the waiting line under Review goes away.
- [ ] Send the app to the background in the middle of a session while online. Swipe it away and
      open it again. Answers given before are not lost, and none is counted twice in the deck.
- [ ] Leave answers unsent (flight mode). Close the app for a day, then open it online. They are
      sent. iOS has no background sync, so the app sends them only when opened.
- [ ] After a week of daily use, the queue and the opened texts are still on the phone. iOS did
      not evict the storage.
- [ ] Settings, Sign out. Signing in again shows no cards, texts or answers left over from before.

### Updates on the phone
- [ ] After a new deploy, open the installed app twice (close it in between). The update notice
      appears on a tab screen. Reload switches to the new version (About shows the new version),
      and answers given before the reload are still sent.

## Findings

| Date | iOS | Check | What happened | Fixed in |
|---|---|---|---|---|
