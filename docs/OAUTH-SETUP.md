# Setting up the "Sign in" buttons

Awuuu ships no OAuth app of its own: you create one with each provider, once, for free, and paste its ID into Awuuu. Your mail and calendar then travel only between your PC and that provider.

Where the IDs go: **Awuuu window → Integrations → Advanced / other providers → OAuth client IDs**.

What Awuuu asks for is read-only: unread mail and today's events. Refresh tokens are kept in the Windows Credential Manager; access tokens stay in memory.

| Provider | You need | Takes |
|---|---|---|
| Google | client ID + client secret | ~10 min |
| Microsoft | client ID | ~5 min |
| GitHub | nothing with the GitHub CLI; a client ID for "Sign in with a code" | ~2 min |

---

## Google (Gmail + Google Calendar)

1. Open <https://console.cloud.google.com/> and create a project (any name, e.g. "Awuuu").
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type **External**, app name "Awuuu", your email as support and developer contact.
   - Scopes: you can skip this step — Awuuu requests `gmail.readonly`, `calendar.readonly`, `openid` and `email` itself.
   - **Test users (Audience)**: add your own Google address.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type **Desktop app**. No redirect URI to enter: desktop clients accept `http://127.0.0.1:<any port>`.
5. Copy the **Client ID** and the **Client secret**.
6. In Awuuu, Advanced → Google: paste the client ID, then paste the client secret and press **Save**.
7. Back at the top of the page, click **Sign in with Google**.

Good to know:

- **"Google hasn't verified this app"** — expected. The app is yours and has not gone through Google's review. Click **Advanced → Go to Awuuu (unsafe)**. The warning is about the app being unreviewed, not about something being wrong.
- **Signed out after 7 days** — while the consent screen is in **Testing**, Google expires refresh tokens after 7 days and Awuuu says "sign in again". To stop that, press **Publish app** on the consent screen (status "In production"). For personal use you do not need to complete verification; the "unverified" screen simply stays.
- **"Access blocked" / error 403 `access_denied`** — your address is not in the test users list (step 3).
- **The client secret** — for Desktop app clients Google does not treat it as confidential, but the token endpoint still requires it. Awuuu keeps it in the Credential Manager.
- **"Turn on the Gmail API…" in a Test** — step 2 was skipped for one of the two APIs.
- Remove Awuuu's access any time at <https://myaccount.google.com/permissions>.

## Microsoft (Outlook mail + calendar)

1. Open <https://entra.microsoft.com/> → **Identity → Applications → App registrations → New registration** (the same page exists in the Azure portal under "App registrations"). A personal Microsoft account can sign in; no paid subscription is needed.
2. Name "Awuuu". Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI: platform **Public client/native (mobile & desktop)**, value `http://localhost/callback`. Register.
   - Awuuu listens on a free port each time (`http://localhost:<port>/callback`); Microsoft ignores the port for `localhost`, so this one entry is enough.
4. **Authentication → Advanced settings → Allow public client flows: Yes**. Save. There is no client secret.
5. **API permissions → Add a permission → Microsoft Graph → Delegated permissions**: `User.Read`, `Mail.Read`, `Calendars.Read`, `offline_access`. (No admin consent is needed for a personal account.)
6. **Overview**: copy the **Application (client) ID**.
7. In Awuuu, Advanced → Microsoft: paste the client ID. Then click **Sign in with Microsoft**.

Good to know:

- **`AADSTS50011` (redirect URI mismatch)** — the redirect in step 3 must be exactly `http://localhost/callback`, under "Mobile and desktop applications", not "Web" or "Single-page application".
- **`AADSTS7000218` (client_assertion or client_secret required)** — step 4 was skipped, or the redirect was added under "Web".
- **Work or school account asks for admin approval** — your organisation restricts third-party apps; an administrator has to consent, or use a personal account.
- Remove access at <https://account.microsoft.com/privacy/app-access> (personal) or <https://myapps.microsoft.com> (work).

## GitHub

**Easiest: the GitHub CLI.** If `gh` is installed and signed in (`gh auth login`), the GitHub card shows **Use GitHub CLI login** — one click, nothing to create. Awuuu reads the token `gh` already has and stores it in the Credential Manager.

**Sign in with a code (device flow):**

1. Open <https://github.com/settings/developers> → **OAuth Apps → New OAuth App**.
2. Name "Awuuu"; Homepage URL and Authorization callback URL can be anything (e.g. `http://localhost`) — the device flow does not use them.
3. Tick **Enable Device Flow**. Register the application.
4. Copy the **Client ID** (starts with `Ov23li…`). No client secret is needed.
5. In Awuuu, Advanced → GitHub: paste the client ID.
6. On the GitHub card click **Sign in with a code**, press **Copy**, then **Open GitHub**, paste the code and approve. The card turns to "Connected" by itself.

Good to know:

- Awuuu asks for `repo`, `read:org` and `notifications` (review requests, failing workflow runs, notifications).
- **"Device flow is off…"** — step 3 was skipped.
- A classic personal access token still works: Advanced → "GitHub with a personal access token".
- Remove access at <https://github.com/settings/applications>.

---

## No account to sign in with?

Advanced also keeps the older ways, used only when nobody is signed in: mail over IMAP with an **app password**, and a calendar's private **iCal link**.
