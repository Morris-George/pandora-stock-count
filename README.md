# Pandora Stock Count
Single-page stock count: load the ERP stock balance (.xlsx), scan barcodes, see ERP vs Actual, recount differences, export to Excel.

## Shared count on the website
`api/db.js` is a small serverless function that stores the count in Upstash Redis, so every device that opens the site sees the same count.

Setup (Vercel dashboard):
1. Project > Storage > Create > Upstash Redis (Marketplace) > connect it to this project (adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`).
2. Optional: Settings > Environment Variables > add `ACCESS_CODE` (a team code devices must enter once).
3. Redeploy.

Without the storage, the site still works but each device keeps its own count in the browser.
