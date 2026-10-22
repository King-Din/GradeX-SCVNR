# GradeX hosting checks (run before a deploy)

The real Vercel function (`src/vercel-api.mjs`) bundled against in-memory stand-ins for
Vercel Blob (files; counts operations) and Upstash's REST API (tables; counts commands and bytes). No network, no live data.

    node qa/build.mjs        # bundle into qa/out/
    node qa/two.mjs          # two server instances: password change on one, next request on the other
    node qa/onboard.mjs      # storage ops for one person's first sign-in (x 232)
    node qa/ops.mjs          # ops per screen, export headers, cache-control
    node qa/upload.mjs       # 4 MB upload limit, byte-identical download
    node qa/race-push.mjs    # two instances saving the same phone: one row
    QA_SEED=none node qa/build.mjs && node qa/upstash.mjs
                             # Blob -> Upstash move, two-instance consistency, commands/KB per screen, upload cap

`serve-like-live.mjs` serves `sites/vercel/public` with the exact headers from
`sites/vercel/vercel.json` (CSP etc.) on :4180 and proxies /api to a local API on :5070.
