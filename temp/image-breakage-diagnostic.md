# Image breakage diagnostic

Date: 2026-11-12. Scope: `site_4geeks-com`, `site_4geeks-florida`, `site_business-4geeks`, the app code that resolves images, and the content repo history of `image-registry.json`.

This is a read-only audit. Nothing under `site_*` or in the app code was changed, and nothing was committed or pushed.

## Verdict

Images do not break because of one bug. There are four separate ways an image stops showing, and all four are triggered by ordinary editing work:

1. **The page uses an image field the visitor pipeline does not know about.** Editors see the image, visitors get nothing. This is the cause on the example landing.
2. **Visitors who move between pages without a full reload keep the first page's image list.** Images on the next page stay blank until they refresh. This is the "blank at first, fine after refresh" symptom, and I reproduced it.
3. **Image records disappear from the registry** while pages still point at them: saves that overwrite each other, and deletes that do not see every place an image is used.
4. **Image files are deleted or renamed** while pages still point at the old address.

In all four cases a visitor sees an empty space, never a broken-image icon, because the image component hides anything it cannot resolve or load. That is why these go unnoticed until someone looks at the page as a visitor.

What is broken for visitors today, as far as this audit can see:

| Kind | Size today |
|---|---|
| Images blank for visitors on every load (cause 1) | 9 live content files; 5 checked in production and confirmed |
| Pages pointing at an image record that no longer exists (cause 3) | 8 image ids on 3 Florida pages, plus 3 files on 4geeks.com |
| Pages pointing at a file that no longer exists (cause 4) | 24 addresses, used 137 times across content files (117 in live files); one student photo accounts for 89 |
| Images blank after in-app navigation (cause 2) | Any section whose images are referenced by id and were not on the page the visitor landed on |

---

## 1. The example: `/landing/ai-engineering-program-ad-es`, section `#features_quad-860mvd`

**What you saw:** in edit mode, a badge "Broken for visitors: 4geeks-perfil-encaja-contigo". For visitors, an empty left column.

**Cause (confirmed):** the image exists and its file loads. The page refers to it in a way the visitor pipeline does not recognise.

- The section is `two_column` / `checklistPanel` and stores the image as `left.image: 4geeks-perfil-encaja-contigo` (`site_4geeks-com/landings/ai-engineering-program-ad-es/es.yml`, lines 176-201).
- Visitors do not receive the whole image registry. The server sends only the records for images it finds on that page (`server/image-registry-subset.ts`). It recognises `image_id`, `*_image_id`, `imageId`, `image: { id: … }` and objects with `id` plus `alt`/`preset`/`src`. A plain `image: <id>` is not on that list.
- `UniversalImage` cannot find the record, and for visitors it renders nothing (`client/src/components/UniversalImage.tsx`).
- Editors get the full registry as soon as edit mode opens, so the image resolves for them and the badge is the only hint.

**Evidence:**

- Local dev server and production both ship 15 image records for this page. `4geeks-perfil-encaja-contigo` is in the page data and absent from the 15. The laptop image in `#features_quad-why-finish` uses `laptop_badges[].image_id`, a recognised field, and is present.
- Introduced by content commit `8cdffb13` (2026-11-12 07:03 UTC, "two_column: add checklistPanel variant … register profile card SVG"). The image was broken for visitors from the moment that variant shipped.

**Second problem on the same image:** the delete protection does not see this reference either, so "Remove unused images" or a manual delete would be allowed to delete an image that is in use.

**Related loss on the same landing, same morning:** commit `8b76ee26` (07:27 UTC) is titled "restore 4geeks-laptop-screen-1-clase-en-directo (dropped when 8cdffb1 overwrote the local registry)". The laptop image record was wiped by the same change and had to be put back. That is cause 3 below, happening on this page within half an hour.

---

## 2. Cause 1: image fields the visitor pipeline does not recognise

Four parts of the system each have their own idea of what counts as an image reference:

| Part | What it recognises |
|---|---|
| Components (what actually renders) | Any field name the component author chose: `image`, `avatar`, `avatars[]`, `logo`, `tall_image`, `stacked_images[]`, `partner_logo`, `brand_image`, … |
| Visitor image list (`server/image-registry-subset.ts`) | `image_id`, `*_image_id`, `imageId`, `imageIdDark`, `image: { id }`, objects with `id` + `alt`/`preset`/`src`, the navbar logo |
| Delete protection (`server/media-gallery.ts`, `collectImageReferences`) | `image_id`, `imageId`, `*_image_id`, `*ImageId`, `logo`, `avatars[]`, addresses, ids hardcoded in components |
| Validators | Their own rules |

Whenever a new component or variant uses a field name outside the second row, the image works in edit mode and is blank for visitors. Nothing fails, warns, or blocks the save.

**Affected content today** (image ids found under fields the visitor list ignores; false positives such as "learnpack" used as a tag were removed):

| File | Field | Checked in production |
|---|---|---|
| `site_4geeks-com/landings/ai-engineering-program-ad-es/es.yml` | `left.image` | Yes, missing |
| `site_4geeks-com/landings/workshop-aiengineering-reskill/es.yml` | `avatars[0..3]` (banner) | Yes, missing |
| `site_4geeks-com/landings/workshop-aiengineering-reskill-latam/es.yml` | `avatars[0..3]` (banner) | Not checked |
| `site_4geeks-com/pages/job-guarantee/en.yml` | `tall_image`, `stacked_images[0..1]` | Yes, missing |
| `site_4geeks-com/pages/press/en.yml` | `items[13].logo` (nbc-logo) | Yes, missing |
| `site_4geeks-com/pages/press/es.yml` | `items[0..5].logo` | Yes, missing |
| `site_4geeks-com/scholarship/miami-tech-works/en.yml` | `partner_logo` | Not checked |
| `site_4geeks-florida/pages/press/en.yml`, `es.yml` | `items[].logo` (7 references) | Not checked |

"Checked in production" means: the id is in the page data that 4geeks.com sends, and it is not in the image list sent with it. For the example landing this matches the edit-mode badge. For the others I did not look at the rendered page in a browser.

**Also at risk (from reading the code, not checked on a live page):** 16 image ids are hardcoded in component code as fallbacks (`HeroShowcase`, `HeroSingleColumn`, `TestimonialsSlideDefault`, `AiLearningDefault`). They are never in page content, so they are never in the visitor list, and a section that relies on the fallback would be blank for visitors. A seventeenth fallback, `rigo-avatar-1763181725290`, does not exist in the registry at all. Full list: `hardcodedIdsInClient` in `temp/image-audit-results.json`.

---

## 3. Cause 2: "blank at first, appears after refresh" (reproduced)

**What happens:** the image list a visitor receives belongs to the first page they load. It is stored in the browser and never refreshed. Links inside the site change pages without a full reload, so the next page renders with the previous page's image list. Any image referenced by id that was not on the first page renders blank. A refresh makes the new page the "first page", it gets its own list, and the images appear.

**Reproduction (local dev server, anonymous browser tab, not in edit mode):**

1. Load `/en/home`.
2. Click the footer link "Academy" (goes to `/en/the-academy` without a reload).
3. Result: the five team photos `alissalandra`, `pablo_bullor`, `laura`, `valentina_ancieta`, `ariana_sanchez` are not rendered (51 image slots on the page).
4. Reload the same address: all five render (56 image slots).

**Why (code):**

- `server/initial-data-middleware.ts` puts the per-page image list into the page under the key `/api/image-registry`.
- `client/src/lib/queryClient.ts` sets `staleTime: Infinity`, so that key is never fetched again.
- `client/src/hooks/useInternalNav.ts` navigates in place. Nothing adds the next page's images to the list.

**How wide:** it affects images referenced by id. Images written as a full address are not affected: the same test from home to `/en/career-programs/ai-engineering` lost nothing, because that page writes its images as addresses. On 4geeks.com today 104 distinct ids are referenced by id across content, so this hits specific sections (such as the team photos) rather than whole pages. I confirmed it on one route only; I did not map every affected page.

**Other things that can produce the same symptom (from reading the code, not reproduced):**

- **A slow or failed download hides the image for good.** If the file fails to load once (timeout, network blip), `UniversalImage` hides it and never retries until the page is reloaded.
- **Visitors can get the previous version of a page for a few seconds after a save.** The page cache (`server/html-page-cache.ts`) keeps serving the old copy while the new one is being built, for up to 8 seconds.
- **Image changes do not refresh cached pages.** Uploading, replacing, optimising or deleting an image never triggers a page rebuild (`server/events/schedule-html-from-event.ts` has no case for it). A cached page keeps the old image record until something else on that page changes or the server restarts.

---

## 4. Edit mode vs read mode vs public

| Who | Image list they have | Page they get | What they see |
|---|---|---|---|
| Staff, edit mode on | Full registry (loaded when edit mode opens) | Built fresh for the editor | Everything renders. "Broken for visitors" badge on images visitors will not get |
| Staff, after leaving edit mode | Still the full registry until they reload (it is never narrowed again) | Cached public copy (being logged in does not skip the cache) | Everything renders, no badges. This looks like the public view and is not |
| Visitor, first load | Only this page's recognised images | Cached public copy | Images from cause 1 are blank |
| Visitor, after clicking an internal link | The first page's list | Rendered in the browser | Images from cause 1 and cause 2 are blank |

The practical consequence: staff cannot trust what they see after closing edit mode. Only a private window, loaded directly on the page, shows the visitor view.

---

## 5. Cause 3: image records disappear from the registry

### What the content repo history shows

`site_4geeks-com/image-registry.json`, 2026-06-25 to 2026-11-12:

- 680 commits touched the file. 672 are automatic ("[Auto-sync] System updated image-registry.json"), 174 of them on 2026-11-11 alone.
- The registry went from 733 records on 2026-10-19 to 1,718 today. 954 records were registered in November (779 of them `og-*` images).
- 48 commits removed at least one record: 263 removals in total. 257 of those ids are absent today, 5 came back later.
- Most removals look intentional (unused AI images: 98 in one commit on 2026-10-19, about 70 on 2026-09-07). The ones below were not.

### 5a. Two saves overwrite each other

The registry is one file, written whole on every change (`saveRegistry` in `server/media-gallery.ts`), with no lock and no merge. Each environment (production, a local dev server, an agent) writes its own full copy and syncs it. Whoever writes last wins, and records added by the other side in between are dropped.

- **2026-11-06, commit `17742a3f`:** added one headshot and dropped four records registered the day before (`icono-instalar-git`, `instalar-git-animacion`, `chuleta-instalar-git-ia`, `learnpack`). Two were restored by hand on 11-07. `icono-instalar-git` and `chuleta-instalar-git-ia` are still missing and still referenced in `site_4geeks-com/how-to/install-git-on-windows-macos-and-linux/es.yml`.
- **2026-11-12, commit `8b76ee26`:** the laptop image on the example landing, described in section 1.

The mechanism is inferred from the code and from what these two commits contain. I did not reproduce an overwrite.

**A live risk on this machine:** the local registry has four records that production does not (`testimonials-ana-6e379600`, `testimonials-carlos-0e94289c`, `testimonials-diana-505f1e47`, `testimonials-en-f14acf72`, all pointing at `https://example.com/*.jpg`). The local dev server created them. A local sync would push them, and a local write based on a stale copy would drop whatever production added since.

### 5b. Deletes that do not see every use

- **Other sites are not checked.** Florida has almost no registry of its own and uses 4geeks.com's. The delete protection on 4geeks.com only looks at 4geeks.com content. Records removed from the 4geeks.com registry on 2026-08-14, 08-24 and 08-31 are still referenced by Florida: 8 ids, 17 references, in `pages/home/es.yml`, `pages/lumi-home` and `pages/home-prueba-lorena` (the last two look like test pages; `pages/home/es.yml` is the Spanish home). These were removed in bursts, which looks like "Remove unused images" or a bulk delete; I could not confirm which.
- **Unrecognised fields are not checked.** Same blind spot as cause 1, with a different field list. Today it leaves one in-use image deletable: the example image.
- **Duplicate removal does not update pages that point at the removed id.** `removeDuplicates` rewrites addresses in content but not id references, and does not check usage first. Found by reading the code; no confirmed case in the history.

Other dead references on 4geeks.com: `blog/what-is-copilotkit-openbot/en.yml` (`_image: ai-1788641583849`, removed 2026-09-07) and `variables.yml` line 851 (`default: "logo-4geeks-white"`, removed 2026-08-10).

---

## 6. Cause 4: files deleted or renamed while pages still point at the address

Most images on the site are not referenced by id. Content holds 1,066 distinct full image addresses across 1,155 files. Those skip the registry, so they are immune to causes 1-3, but they break when the file behind the address goes away.

I requested every one of them. **24 do not return an image.** They are used 137 times across content files (117 in live files). Full list with files: `temp/image-audit-dead-urls.json`.

| Address (file name) | Files | What happened |
|---|---|---|
| `media/Leandro_1764725403142.jpeg` | 89 (83 landings, 4 pages, 2 Florida) | File and registry record both gone. The testimonial photo for Leandro Matonte is blank on all of them. Cause not traceable: it predates the history I could read |
| `media/ChatGPT-Image-Mar-26-2026-04_26_00-PM.png`, `media/664da5b4….jpg`, `media/download-1..4-.png`, `download-4-.jpg` | 2-4 each, Florida | The 4geeks.com pages use a renamed, optimised copy of the same images (`…-1024x1536.webp`, `…-900x1758-q74.webp`) and load fine. This fits "replace/optimise renamed the file and updated only 4geeks.com content", though I did not trace the exact commits |
| Three `…-640w.webp` addresses in blog posts | 1 each | The post points straight at a resized copy, not the original. Resized copies are deleted and regenerated when an image is replaced. The registry still has records pointing at these dead files |
| `4geeksacademy.com/static/…`, `/images/…`, `/wp-content/…` (5 addresses) | 9 | Old website domain. It redirects to `www.4geeksacademy.com`, which no longer resolves |
| `media/joao.png`, `site_4geeks-com/media/avatar-12.png`, `breathecode…/programmer-at-night-2-jpg`, others | 1-3 each | File gone, cause unknown |
| `media/premios_tecnol`, `media/student-2-latin.pngtin.png` | 2, 4 | Address is truncated or mangled in the content itself |

How replacing an image breaks addresses (`replaceAndRegister`, `server/media-gallery.ts` lines 1647-1814): it deletes the resized copies first, converts to WebP, uploads under a new name when the extension changes, rewrites addresses in the owning site's content, then deletes the old file. Any reference it does not rewrite (another site, a cached page, a resized-copy address) points at a deleted file.

The registry's own files are healthy: all 711 files behind images referenced by id on live pages load.

---

## 7. Why constant changes keep breaking images

The common root is that an image reference is not a tracked thing. It is a string in YAML, and each subsystem guesses which strings are images.

- **No single definition of "image reference".** Rendering, the visitor list, delete protection and validation each use different rules, so they disagree, and every new component can widen the gap.
- **Nothing checks the visitor view on save.** The edit-mode badge is the only signal, and it appears only if someone opens that section in edit mode.
- **Failures are silent for visitors.** Missing record, missing file and failed download all render as empty space.
- **The registry is a single shared file with last-writer-wins saves**, written by production, local dev servers and agents, and it is now changing hundreds of times a day.
- **Image operations are not connected to pages.** Replace, optimise, dedupe and delete do not refresh cached pages, do not update other sites, and do not rewrite id references.
- **Two ways to reference an image** (id and full address) with different failure modes, mixed within the same page.

---

## 8. Suggested directions (proposals, nothing implemented)

In the order I would take them:

1. **Send visitors every image the page actually uses.** Either make the visitor list collect any string that matches a registry id (cheap, fixes cause 1 for every current and future field name), or have components declare their image fields in the component schema and build all four lists from that. The first can ship on its own.
2. **Fix the in-app navigation gap.** Deliver the next page's image records with its page data and merge them into the browser's list, or fetch the missing ids on demand. Fixes cause 2.
3. **Stop registry overwrites.** Merge per record on save and sync (never write a whole stale copy), and keep local dev servers from pushing the registry. Fixes 5a.
4. **Make deletes and replaces see every use.** Include sites that fall back to this registry, use the same reference rules as rendering, refuse or warn on in-use images, and rebuild cached pages after any image change. Fixes 5b and most of cause 4.
5. **Add a visitor-view check.** Run this audit (or a validator built from it) in CI or on save so a page that would be blank for visitors is flagged before it ships. An option worth considering: retry a failed image load once before hiding it.
6. **Repair today's content.** The lists in sections 2, 5 and 6 and the two JSON files are the worklist. Restoring the Leandro photo alone fixes 89 files. Content repairs would go through the content repo; registry repairs on production should be a numbered migration.

Items 1 and 2 remove the two symptoms you reported. Items 3 and 4 are what stops new breakage from accumulating.

---

## 9. What was and was not verified

**Confirmed by direct evidence**

- Example landing: id in page data and missing from the visitor image list, locally and on 4geeks.com.
- Same check on `/en/job-guarantee`, `/en/press`, `/es/prensa`, `/landing/workshop-aiengineering-reskill` on 4geeks.com.
- In-app navigation blanking: reproduced in a browser against the local dev server (home to the-academy), with a reload as the control.
- Registry removals and the two overwrite incidents: read from content repo commits.
- Dead addresses: each requested; failures re-checked one by one. 27 first-pass failures turned out to be transient and are excluded.

**Inferred from code or patterns, not reproduced**

- The exact mechanism of the registry overwrites (stale whole-file write).
- That the August removals came from "Remove unused images" or bulk delete.
- That the Florida dead addresses came from replace/optimise renaming files.
- The three secondary "appears after refresh" mechanisms in section 3 (no retry, 8-second old copy, no rebuild on image change).
- That duplicate removal has broken id references in practice.

**Not checked**

- In-app navigation blanking on production (only local).
- The rendered page in a browser for the section 2 pages other than the example.
- Draft-only content as a visitor-facing problem (drafts are counted in the JSON but not in the tables above).
- Two Florida YAML files that fail to parse, and one Florida registry record (`4geeks-academy-logo-florida`) whose local file is missing on this machine.
- 16 registry records on 4geeks.com that have a source address but no stored file (pending or failed downloads).
- Whether saving in edit mode refreshes the "Broken for visitors" badge without a reload.

---

## 10. Files from this audit

- `temp/image-breakage-diagnostic.md`: this document.
- `temp/image-audit.ts`: read-only audit script. `npx tsx temp/image-audit.ts` for the static checks, add `--http` to request every image address (about two minutes).
- `temp/image-audit-results.json`: full output of the last run (per-site lists of unrecognised fields, dead ids, delete-protection gaps, hardcoded ids, first-pass address checks, which include transient failures).
- `temp/image-audit-dead-urls.json`: the 24 confirmed dead addresses and the files that use them.

`temp/` is new, untracked in the app repo and not gitignored.
