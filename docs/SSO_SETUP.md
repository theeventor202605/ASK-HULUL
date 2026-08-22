# Single Sign-On setup (Google + Microsoft Entra ID)

REQ: "Add Login through MS Entra or google login." This is a SystemAdmin-only setup task, done
once per deployment. It doesn't require touching any code — everything is pasted into
**Settings → Single Sign-On** once you have it.

## How it works, briefly

SSO is sign-**in** only, never sign-up: a successful Google or Microsoft sign-in is matched to an
existing, Active HULUL account by email. If no matching account exists, the person is told to
contact their SystemAdmin — the same "accounts are provisioned by an admin" model this app already
uses everywhere else. Google/Microsoft Client IDs are not secrets (both providers' own docs say
so — they're meant to be embedded in browser-side app code), so pasting them into Settings and
having the frontend read them back is safe by design.

**Password login stays on by default even after you set this up.** The Settings tab's "Require
SSO (disable password login)" checkbox is a separate, explicit step — and it's disabled until at
least one provider below is enabled and configured, so you can't accidentally lock every account
(including your own) out of the app. Recommended order: configure a provider, test that you
personally can sign in with it, *then* come back and check that box if you actually want the
password form gone.

You only need to do ONE of Google or Microsoft below to turn SSO on — do both if you want to offer
your users a choice.

## Before you start

You'll need your GitHub Pages URL — the exact address HULUL is served from, e.g.
`https://<you>.github.io/hulul/` (see `docs/DEPLOYMENT.md` section 3 if you don't have this yet).
Both setups below ask for it as an "allowed origin" — get it exactly right (including `https://`,
no trailing content after the domain for Google; a specific redirect path for Microsoft) or the
sign-in button will fail with an origin/redirect-mismatch error.

## Part A — Google

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and either pick an existing
   project or create a new one (top-left project picker → **New Project**).
2. **APIs & Services → OAuth consent screen.** Choose **External** (unless every HULUL user is in
   your own Google Workspace, in which case **Internal** is fine and skips verification). Fill in
   the app name (e.g. "HULUL") and your support email. You can leave scopes at the default — this
   app only ever asks Google to confirm who signed in, nothing more.
3. **APIs & Services → Credentials → + Create Credentials → OAuth client ID.**
   - Application type: **Web application**
   - Name: anything recognizable, e.g. "HULUL login"
   - **Authorized JavaScript origins**: add your GitHub Pages origin, e.g.
     `https://<you>.github.io` (origin only — no path, no trailing slash)
   - Leave **Authorized redirect URIs** empty — Google Identity Services' button flow used here
     doesn't redirect through a callback URL.
4. Click **Create**. Copy the **Client ID** shown (it ends in
   `.apps.googleusercontent.com`) — you do not need the client secret, this flow never uses one.
5. In HULUL: **Settings → Single Sign-On → Google sign-in** — check **Enable Google sign-in**,
   paste the Client ID, click **Save**.
6. Log out and confirm a "Sign in with Google" button now appears on the login screen, and that it
   successfully signs you into your own (Active, email-matching) HULUL account.

## Part B — Microsoft Entra ID

**Register this once, in any one organization's Entra tenant — it works for every organization's
users, not just that one.** HULUL is used by multiple separate organizations (GA, EMC, Inspection
companies), almost certainly each with its own Entra tenant. Rather than needing a separate
registration per organization (and some way for the login screen to guess which one a given user
belongs to before they've even signed in), this app registration is set up as **multi-tenant**: any
Entra work/school account, from any organization, can attempt to sign in. That doesn't loosen
security — HULUL still only lets someone in if their verified email matches an existing, Active
account you provisioned (see "How it works, briefly" above). A user from `emc.sa` and a user from
`gea.gov.sa` can both use this same Microsoft sign-in button, as long as both already have their
own HULUL account.

1. Go to the [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID** → **App
   registrations** → **+ New registration**. (Any one organization's tenant works — the
   registration itself doesn't need to belong to a specific org once it's multi-tenant.)
2. Name it (e.g. "HULUL login"). Under **Supported account types**, choose **"Accounts in any
   organizational directory (Any Microsoft Entra ID tenant — Multitenant)"** — not the
   single-tenant option, or users from every organization except the one that registered it will
   be rejected before HULUL ever sees them.
3. Under **Redirect URI**, select platform **Single-page application (SPA)** and enter your
   GitHub Pages URL, e.g. `https://<you>.github.io/hulul/` (this one DOES need the full path, not
   just the origin — MSAL's popup flow redirects back to this exact page).
4. Click **Register**. On the app's **Overview** page, copy the **Application (client) ID**. You
   don't need the Directory (tenant) ID for anything — HULUL authenticates against the shared
   `/organizations` endpoint, not one specific tenant.
5. **API permissions** (left nav) → confirm `User.Read` (Microsoft Graph, delegated) is listed —
   it's added by default on a new registration. That's the only permission this integration needs;
   it's used solely to read the signed-in user's email back from Graph to match it against a HULUL
   account.
6. In HULUL: **Settings → Single Sign-On → Microsoft sign-in** — check **Enable Microsoft
   sign-in**, paste the Application (client) ID, click **Save**.
7. Log out and confirm a "Sign in with Microsoft" button now appears on the login screen, and that
   it successfully signs you into your own (Active, email-matching) HULUL account. Ask a colleague
   in a *different* organization's tenant (if you have one) to try it too, to confirm multi-tenant
   is actually working. The first sign-in for any given Microsoft account may prompt an
   admin/user consent screen — that's Entra ID itself, not a HULUL bug; each organization's own IT
   admin may need to approve the app for their tenant the first time one of their users tries it,
   depending on their own tenant's consent policy.

## Troubleshooting

- **"No HULUL account was found for ‑‑‑"**: expected behavior for an unmatched email — create the
  account first (Users & Roles), matching the email exactly, then try again.
- **Google button doesn't appear at all**: usually the Authorized JavaScript origin doesn't match
  the page's actual origin exactly (protocol + host, no path). Re-check step A3.
- **Microsoft popup fails/closes immediately with a redirect error**: the SPA redirect URI in
  Entra (step B3) doesn't exactly match the page URL MSAL is running from. Re-check it's the exact
  GitHub Pages URL, including trailing slash if that's how you access the app.
- **"This Google sign-in was issued for a different application" / Microsoft sign-in verification
  fails**: the Client ID pasted into Settings doesn't match the one on the provider's own
  dashboard — re-copy it.
- **A user from another organization's Entra tenant can't sign in with Microsoft at all** (the
  popup itself rejects them, before they ever reach HULUL): the app registration is still set to
  single-tenant. Go back to step B2 and change **Supported account types** to the multi-tenant
  option — this can be changed after the fact on an existing registration, no need to re-create it.
