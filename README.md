# Kindred

A calm little web app for two people to share how they're feeling (sickness, sleep, stress, affection, each 0 to 100) without having to talk it through. Hosted on GitHub Pages, data in Firebase Firestore, wrapped in Hermit on each phone.

## Files
- `index.html` the whole app
- `backend.js` storage (Firestore, or a this-device-only demo mode when `config.js` is empty)
- `config.js` your Firebase web config
- `sw.js`, `manifest.webmanifest`, icons: install to home screen
- `firestore.rules` database rules (one check-in per 4 hours, tidy data)

## Set up Firebase (about 5 minutes)
1. Go to https://console.firebase.google.com and click **Create a project**. Name it `kindred`. You can turn Google Analytics off.
2. In the left menu open **Build > Firestore Database**, click **Create database**, pick a location near you (e.g. `australia-southeast1`), and start in **production mode**.
3. Open the **Rules** tab, replace everything with the contents of `firestore.rules`, and click **Publish**.
4. Click the gear next to **Project overview > Project settings**. Under **Your apps** click the `</>` (web) icon, name it `kindred`, skip hosting, and copy the `firebaseConfig` values into `config.js`.

## Publish on GitHub Pages
Push these files to the repo, then in the repo go to **Settings > Pages**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`. The site appears at `https://<user>.github.io/<repo>/`.

## Hermit
On each phone, create a Lite App in Hermit with the Pages URL.

## How it works
- Sign in by typing a name (no password). Pick your partner from people who have signed in. You see each other once you've both picked each other.
- One check-in per 4 hours, enforced by the app and by the database rules.
- The last 60 check-ins per person are kept (enough for the 7-day trends).
- Wishes: add up to 3 to a check-in; tap your own wish when your partner grants it.
- "I see you, <name> ❤️": one tap on your partner's card lets them know you noticed.
- Dev menu: tap the version number in settings 3 times.
- A gentle nudge appears once it's been 8 hours since your last check-in.
- Installable: add to your home screen for a heart icon and full-screen app.
- Colours, style and layout are chosen per phone in settings.
- Privacy note: there are no passwords, so anyone who knows the link could read the levels. Keep the link between the two of you.
