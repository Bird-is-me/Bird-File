const requiredVariables = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
];

const values = Object.fromEntries(
  requiredVariables.map((name) => [name, process.env[name]?.trim() ?? ""]),
);

const missingVariables = requiredVariables.filter((name) => !values[name]);
if (missingVariables.length) {
  throw new Error(`Missing environment values: ${missingVariables.join(", ")}`);
}

if (
  values.ADMIN_EMAIL === "YOUR_GMAIL" ||
  values.ADMIN_PASSWORD === "YOUR_PASSWORD" ||
  values.SUPABASE_SECRET_KEY === "PASTE_YOUR_ROTATED_SECRET_KEY"
) {
  throw new Error("Replace all placeholder values in the workspace-root .env.local first.");
}

if (values.SUPABASE_SECRET_KEY.startsWith("sb_publishable_")) {
  throw new Error("Use a rotated Supabase secret key, not the publishable key.");
}

const response = await fetch(
  `${values.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/admin/users`,
  {
    method: "POST",
    headers: {
      apikey: values.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${values.SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: values.ADMIN_EMAIL,
      password: values.ADMIN_PASSWORD,
      email_confirm: true,
    }),
    signal: AbortSignal.timeout(15000),
  },
);

if (!response.ok) {
  const error = await response.json().catch(() => ({}));
  throw new Error(`Account creation failed (${response.status}): ${error.msg ?? error.message ?? "Check the credentials and try again."}`);
}

console.log(`Private account created for ${values.ADMIN_EMAIL}.`);