// All admin writes go through this — never directly to Supabase from the browser.
// The admin password is sent as a header; the server verifies it before acting.

export async function adminAction(action, payload) {
  const password = sessionStorage.getItem('adminPw') || ''
  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-token': password,
    },
    body: JSON.stringify({ action, payload }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Admin API error')
  return data
}
