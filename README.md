# Bird Files setup

Bird Files is a static file manager backed by Supabase Auth and a private Storage bucket. Email sign-up is available when enabled in Supabase. Files are stored under each user's auth ID; Row Level Security prevents users from reading or changing another user's files.

## Configure Supabase

1. In Supabase, open **SQL Editor** and run `supabase/migrations/202611160001_private_file_storage.sql`.
2. In **Authentication → Providers → Email**, enable email/password sign-ups. If email confirmation is on, configure SMTP so confirmation emails can be delivered.
3. Keep the `bird-files` bucket private. The migration creates it as private and adds per-user Storage policies.
4. In **Authentication → URL Configuration**, set the deployed site URL and add `http://localhost:8000/**` to the redirect allow list for local testing.

Anyone can create an account while email sign-ups are enabled, but the Storage policies limit each account to its own files. To make registration invite-only instead, disable email sign-ups and create approved users through the local account script below.

If SQL Editor is unavailable, create the bucket as private under **Storage → Buckets**, then open **Storage → Policies** and add policies for `storage.objects`, all for role `authenticated`:

- **SELECT**: put the expression in **USING**.
- **INSERT**: put the expression in **WITH CHECK**.
- **UPDATE**: put the expression in both **USING** and **WITH CHECK**.

```sql
bucket_id = 'bird-files'
and (storage.foldername(name))[1] = auth.uid()::text
```

The public URL and publishable key are configured in `app.js`; these are intended for browser use. Never put a Supabase secret or service-role key in this site. Rotate any secret key that was shared in chat.

## Create the first private account

The account-creation script is local and uses the Supabase Admin API. Its secret key is never sent to the browser. Edit `.env.local` in the workspace root (one directory above `bird.freehosting.dev`) and replace the placeholders:

```dotenv
SUPABASE_URL=https://nwbsosabmknpeyxoqskm.supabase.co
SUPABASE_SECRET_KEY=PASTE_YOUR_ROTATED_SECRET_KEY
ADMIN_EMAIL=YOUR_GMAIL
ADMIN_PASSWORD=YOUR_PASSWORD
```

Use a newly rotated secret key, keep `.env.local` out of the website's deployed files, and do not share the password. From this directory, run the script once:

```sh
node --env-file=../.env.local supabase/scripts/create-account.mjs
```

It creates a confirmed email/password account. The script is an alternative for invite-only deployments where public sign-ups are disabled.

## Local preview

From this directory, serve the static files over HTTP:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Static HTML should be served over HTTP, not opened directly as a `file://` URL.

HTML previews run inside an isolated sandbox and load linked `.js` and `.css` files from the signed-in user's private bucket. Creating a real subdomain requires access to the hosting provider's domain/DNS controls; repository code alone cannot create a DNS record.

## Dashboard shortcuts

- **Files** provides multi-file upload, folder upload, and **Create** for a new text file. Folder selection depends on browser support.
- **Hosting** provides domain and cPanel shortcuts. Set the website URL and cPanel URL under **Settings** first; these URLs are saved only in the current browser. Create the actual subdomain in cPanel.
- **Database** opens the Supabase project dashboard. Database administration does not use a secret key in this website.

## Deploy the health function

The optional health endpoint lives in `supabase/functions/health`. From this directory:

```sh
supabase login
supabase link --project-ref nwbsosabmknpeyxoqskm
supabase functions deploy health --no-verify-jwt
```

The file manager itself uses Supabase Auth and Storage directly and does not depend on this function.

## Bird Program language

Open **Bird Program** to edit `main.bird` and run Bird code locally in the browser. `r` declares a number, `s` a string, `e` a number-or-string value, and `v` a list. Access typed values with `.r` or `.s`; access lists as `v.names` and use zero-based indexing such as `v.names[0]`. Strings support escapes including `\n`, `\t`, `\\`, and `\"`. `True`, `False`, comparisons, `and`, `or`, `not`, and indented `if/elif/else` blocks are supported. `input("prompt")` pauses execution and displays an inline input in Output; submit it to continue. Functions use indented `fbs name(e.parameter):` blocks and are called by name. `let` remains available for inferred types. The language reports line-numbered errors and does not evaluate arbitrary JavaScript. **Save .bird** stores the program in the signed-in user's private bucket, so the bucket and Storage policies must be configured first.

```bird
fbs greet(e.person):
	print("Hello, " + e.person)

v names = ["Bird", "Sky"]
e name = input("Name?")
if True and not False:
	greet(name.s)
elif name.s == "sky":
	print(v.names[1])
else:
	print("unknown")
print(v.names[0])
```

## Features

- Sign in or create an email/password account.
- Upload multiple files to the signed-in user's private folder.
- Preview images, PDFs, audio, video, and text files.
- Edit and save text-based files.
- Download files through short-lived signed URLs.
- Write, run, and save `.bird` programs with syntax highlighting.