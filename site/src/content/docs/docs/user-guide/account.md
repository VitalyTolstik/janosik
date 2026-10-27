---
title: Account, keys and preferences
description: Sign in, manage your profile, password and API keys, set preferences, and back up your data.
---

Accounts exist only in server mode. In local mode the app opens straight to
your boards with no sign-in, and the account button is hidden.

## Sign in and register

The sign-in screen has one form with two modes. `Sign in` asks for your
`Email` and `Password`; `Create account` adds an optional `Name` and creates
the account, because one account keeps boards in sync across devices. The link
at the bottom switches between the two modes.

![The sign-in screen.](/screens/login.png)

If the operator has enabled external sign-in, buttons such as `Continue with
<provider>` appear below the form. An operator can also close registration;
when it is closed, only the sign-in form is shown.

After five wrong passwords for one address, sign-in pauses for that address:
first for 30 seconds, then twice as long after each further miss, up to 15
minutes. The message says how long to wait.

Signing in with a provider uses the account that already has your address.
If that account never confirmed its email, the provider sign-in takes it
over cleanly: the password set at registration, every signed-in device and
every API key are cleared, and from then on you sign in with the provider.

## Confirm your email

After registering, the app asks you to `Confirm your email`. It sends a
six-digit code to your address; type it in and press `Confirm`. If the code
does not arrive, use `Resend code`. You can also `Sign out` from this screen.

## The account panel

The account button in the header opens a panel with an identity band on top
and a section list on the left: `Profile`, `Security`, `API keys` and
`Preferences`. `Sign out` sits at the bottom of the list, behind a
confirmation.

### Profile

![The Profile section: photo, avatar colour, display name and email.](/screens/account-profile.png)

- `Profile photo` — upload a PNG, JPEG, GIF or WebP image. The uploaded photo
  replaces the initials.
- `Avatar color` — pick a colour for your initials, or leave it on automatic.
- `Display name` — shows on cards, in the feed and in the presence stack.
- `Email` — your sign-in address, shown read-only. Use `Change` to start the
  change flow.

### Security

**Change your email** is a double opt-in: enter the new address and your
current password, and the app sends a six-digit code to the new address. Type
the code to confirm. Other devices are signed out after the change.

**Change your password** asks for your current password and a new one, entered
twice. After a change, other devices are signed out and every API key is
revoked, so create new keys for your scripts and agents.

### API keys

![The API keys section: create personal tokens for scripts and integrations.](/screens/account-api-keys.png)

API keys are personal tokens for scripts and integrations. A token acts as
you, so keep it secret.

Use `Create key`, give it a `Name`, and choose when it expires: `Never`,
`In 30 days`, `In 90 days` or `In a year`. The key itself is shown once, with
a `jnk_` prefix; copy it then and store it in a password manager. The list
shows each key's name, status (`Active`, `Expired` or `Revoked`), when it was
created, when it was last used and when it expires. `Revoke` stops a key
immediately and cannot be undone; a live connection opened with the key
closes within about 25 seconds.

Keys are managed only here, in a signed-in browser. A key cannot list, create
or revoke keys, or change your password or email, so a leaked key can never
mint a longer-lived one or lock you out of your account.

### Preferences

![The Preferences section: language, time format, theme and board background.](/screens/account-preferences.png)

Preferences are personal and apply to this browser:

- `Language` — English or Русский.
- `Time format` — `Auto` (follows the language), `12-hour (AM/PM)` or
  `24-hour`.
- `Theme` — `Light` or `Dark`.
- `Board background` — `Solid`, `Paper`, `Dots` or `Grid`.

Column transparency and blur are set on the board itself, from the column
appearance menu in the board view.

## Offline use and installing the app

Janosik is installable as a web app. It ships a manifest that requests a
standalone window and a service worker that caches the app shell and its
hashed files, so the app opens with the network cut. Use your browser's own
install option to add it; the app has no separate install button.

In local mode the app works fully offline, because everything is in your
browser. In server mode the app still opens offline, but saving changes needs
the network: an edit made while offline is not stored.

## Data and backups

The data menu in the header manages your data.

![The data menu: export, import, a manual copy, the card archive and automatic backups.](/screens/data-menu.png)

- `Export JSON` downloads all your boards as `janosik-boards.json`.
- `Import JSON` reads a Janosik export. In local mode importing replaces your
  current data set; in server mode it adds the imported boards.
- `Save a copy now` writes a backup copy straight away.
- `Automatic backups` opens the list of copies the app kept on its own while
  you worked. From there you can restore a copy or delete it. Restoring takes
  a safety copy of the current state first.
- `Card archive` opens the active board's archived cards, where you can
  restore or delete them.

![The card archive: archived cards of the active board, with restore and delete.](/screens/archive.png)

Automatic backups run in local mode. In server mode your boards live in the
database, and board data is not mirrored into the browser.

### The data-safety banner

When local storage is at risk, a banner appears above the header.

- `Data is not being saved` — storage refused the last write. The banner
  cannot be dismissed; its action downloads a backup of what is still in
  memory. It clears when a write succeeds again.
- `Storage is almost full` — saving still works, but the data is near the
  storage limit. Download a backup and delete boards you no longer need.
- `Saved data was damaged` — the stored data could not be read. You can
  download the damaged copy or restore an automatic backup.
