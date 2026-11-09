# Mapping a site's content

Start from what the site already renders. The aim is one `pubba.json` that a
build step can regenerate whenever the content changes, so prefer reading the
source files over copying their contents by hand.

## Where content usually lives

| Source | What to look for | Becomes |
| --- | --- | --- |
| JSON / YAML data files (`data/`, `content/`, `src/lib/data`) | arrays of projects, skills, jobs, products | one entity per item; list fields (`technologies`, `tags`, `categories`) become links |
| Markdown with front matter (`content/**/*.md`, MDX) | `title`, `slug`, `tags`, `stack`, `date`; the body | front matter → entity and links; body → `text` (topics and mentions read it) |
| CMS export (Contentful, Sanity, Strapi, Firestore JSON) | content types and reference fields | content type → entity type; reference fields → links |
| Database dump / seed files | tables and join tables | rows → entities; join tables → links |
| The site's own pages | headings, nav, project grids | only when nothing structured exists |

## Portfolio content → the portfolio preset

| Portfolio field | PortfolioInput |
| --- | --- |
| About / bio | `person` (`name`, `short` = first name, `jobTitle`, `sameAs` = profile links) |
| Experience / timeline | `roles[]`: `title`, `company`, `points` (the bullet list; it's what made-at and used-at read) |
| Projects / case studies | `projects[]`: `slug`, `title`, `subtitle`, `description`, `category` (platforms, comma separated), `tags` (`founded` for own ventures), `technologies` |
| Skills / stack | `skills[]` with a `category`: Languages and Frameworks weigh 1 (they define a stack), Platforms 0.7, Design and Tools 0.4 |
| Countries / clients' markets | `markets[]` with `code`, `name` and short forms in `aliases` ("UAE", "PNG") |
| Hobbies | `games[]`, `creative[]` |

Checks before proposing:

- Every technology a project lists should be in `skills` with a category; an
  unknown one gets 0.7 and may wrongly pull projects together.
- Project text should name the places it shipped, or add them to the
  description; that's where `shipped-in` comes from.
- Role bullets should name the projects and tools of that job; that's where
  `made-at` and `used-at` come from.
- Add aliases for what people actually type: abbreviations ("ts", "rn"), old
  names, company names, a project's nickname.

## Anything else → entities, links and config

Pick types for the things a visitor can go to (destinations) and for the things
that only connect them (materials, platforms, topics: `"destination": false`).
Then:

| Showroom | Types | Content links | Derived rules |
| --- | --- | --- | --- |
| Product catalogue | product, brand, category, material | made-by, in-category, made-of | `shared` products by core materials → goes-with; `co-occur` materials |
| Course list | course, topic, instructor, level | about, taught-by, at-level, prerequisite | `shared` courses by topic → similar; `label-prefix` for course series (Part 1 → Part 2) |
| Docs | page, concept, api, version | explains, uses-api, see-also | `named-in` pages that mention an API name; `shared` pages by concept |

Give every kind a `pull` (how strongly it leads a visitor on: "same series" 1,
"mentions" 0.5) and a template sentence. Start from `templates/pubba.custom.json`.

## What to show the user for review

Run `pubba.sh preview <draft>` and summarise: counts per type, the kinds, the
aliases you invented, the weights you chose for common versus core items, five
or six derived links with their `via`, and anything dropped. Point out guesses
(a category you inferred, an alias you made up) so the user can correct them.
