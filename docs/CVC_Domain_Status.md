# CVC Domain Preparation Status

The CVC application is hosted on Vercel, with DNS for `https://cvcfantasyfootball.com/` managed at Namecheap. Metadata (title, description, theme color, canonical URL, Open Graph tags) is already set for that domain in `client/index.html`.

See `docs/CVC_League_Onboarding.md`'s "Custom domain handoff" section for the exact Vercel + Namecheap cutover steps. DNS is not bound automatically by any code change here — the domain must be added in the Vercel dashboard and the resulting records added in Namecheap before the site resolves at the custom domain.
