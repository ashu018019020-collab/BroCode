import { createClient } from '@supabase/supabase-js';

function required(config, key) {
  const value = config[key];
  if (!value) throw new Error(`Set ${key} before starting the account API.`);
  return value;
}

export function createSupabaseServices(config = process.env) {
  const url = required(config, 'SUPABASE_URL');
  const publishableKey = required(config, 'SUPABASE_PUBLISHABLE_KEY');
  const secretKey = required(config, 'SUPABASE_SECRET_KEY');
  const authOptions = { auth: { autoRefreshToken: false, persistSession: false } };

  return {
    auth: createClient(url, publishableKey, authOptions),
    admin: createClient(url, secretKey, authOptions),
  };
}

export async function listAllAuthUsers(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}
