# Releasing

Pushing a version tag such as `1.3.0` runs `.github/workflows/release.yml`:

1. **version** checks that the tag equals every version field: `package.json`, `src/version.ts`, `packages/python/pyproject.toml`, `packages/python/pubba/__init__.py`, `packages/kotlin/gradle.properties`, `Version.kt`, `packages/dart/pubspec.yaml`, `packages/dart/lib/pubba.dart` and `packages/php/src/Pubba.php`.
2. **tests** runs the whole CI workflow (`ci.yml`) on the tag, conformance suite included.
3. Four publish jobs then run side by side, so one failing doesn't stop the others: **npm**, **pypi**, **pub-dev** and **maven-central**.

The Swift Package and Packagist need nothing: they pick up the tag.

A tag with a hyphen (`1.3.0-rc.1`) is published to npm under the `next` dist-tag instead of `latest`.

## One-time setup

All four publish jobs run in a GitHub environment called `release`. npm, PyPI and pub.dev use trusted publishing (OIDC), so they need no tokens. Only Maven Central needs secrets.

### 1. GitHub environment

1. Open github.com/Tharindu127/pubba → **Settings → Environments → New environment**.
2. Name it `release` and save.
3. Optional: under **Deployment branches and tags**, choose **Selected branches and tags** and add a tag rule `[0-9]*`. You can also add yourself as a **Required reviewer** so that each release waits for your click.

### 2. npm (trusted publishing)

1. Sign in at npmjs.com and open the `pubba` package → **Settings**.
2. Under **Trusted Publisher**, choose **GitHub Actions** and enter:
   - Organization or user: `Tharindu127`
   - Repository: `pubba`
   - Workflow filename: `release.yml`
   - Environment: `release`
3. Save. Optional: on the same page, set **Publishing access** to require 2FA and disallow tokens, so only the workflow can publish.

### 3. PyPI (trusted publishing)

1. Sign in at pypi.org and open **Your projects → pubba → Manage → Publishing**.
2. Under **Add a new publisher**, choose **GitHub** and enter:
   - Owner: `Tharindu127`
   - Repository name: `pubba`
   - Workflow name: `release.yml`
   - Environment name: `release`
3. Click **Add**.

### 4. pub.dev (automated publishing)

1. Sign in at pub.dev and open the `pubba` package → **Admin** tab.
2. Under **Automated publishing**, tick **Enable publishing from GitHub Actions** and enter:
   - Repository: `Tharindu127/pubba`
   - Tag pattern: `{{version}}` (our tags have no `v` prefix)
3. Tick **Require GitHub Actions environment** and enter `release`.
4. Click **Update**.

### 5. Maven Central (secrets)

The Kotlin build uses the `com.vanniktech.maven.publish` plugin. The workflow runs `gradle publishAndReleaseToMavenCentral`, which uploads, signs and also **releases** the deployment in the Central Portal, so you no longer press Publish there by hand. To keep a manual check in the Portal instead, change that task to `publishToMavenCentral` in `release.yml`.

1. Get a Portal user token: sign in at central.sonatype.com → **View Account → Generate User Token**. It gives a username and a password. These are not your login.
2. Export your signing key as ASCII armour, on your own machine:
   ```bash
   gpg --list-secret-keys --keyid-format short
   ```
   ```bash
   gpg --export-secret-keys --armor YOUR_KEY_ID
   ```
   Copy the whole output, including the `-----BEGIN PGP PRIVATE KEY BLOCK-----` and `-----END …-----` lines.
3. Open github.com/Tharindu127/pubba → **Settings → Environments → release → Environment secrets → Add environment secret** and add:

   | Secret | Value |
   | --- | --- |
   | `MAVEN_CENTRAL_USERNAME` | the user-token username |
   | `MAVEN_CENTRAL_PASSWORD` | the user-token password |
   | `SIGNING_KEY` | the armoured private key from step 2 |
   | `SIGNING_KEY_PASSWORD` | the key's passphrase (leave out if it has none) |
   | `SIGNING_KEY_ID` | optional: the short key ID, needed only when signing with a subkey |

4. Make sure the public key is on a keyserver (`gpg --keyserver keyserver.ubuntu.com --send-keys YOUR_KEY_ID`); Maven Central checks signatures against it. It already is if earlier releases went through.

## Cutting a release

1. Bump every version field listed above and update `CHANGELOG.md`; commit.
2. Tag and push:
   ```bash
   git tag 1.3.0
   ```
   ```bash
   git push origin main 1.3.0
   ```
3. Watch the **release** run under the repository's **Actions** tab.

If one registry fails, fix the cause and use **Re-run failed jobs** on the same run. Registries refuse a version that's already there, so re-running only the failed job is the safe path. If the version check fails, don't move the tag: fix the files, then delete and re-push the tag (nothing was published yet).

## The weekly check

`.github/workflows/weekly.yml` runs every Monday at 03:00 UTC and opens a
GitHub issue labelled `weekly-report` (closing the previous one), so GitHub
emails you a summary. It is read-only: it never changes code, never tags and
never publishes.

What it checks:

- **Health:** the full CI on every runtime, and the latest package from each
  registry (npm, PyPI, pub.dev, Packagist, Maven Central), installed the way a
  user would, against the conformance suite. The Swift Package is resolved
  from GitHub at the latest tag and must give the TypeScript reference's
  answers.
- **Versions:** every registry shows the latest git tag.
- **Advisories:** `npm audit` on the build tools (the packages themselves have
  no runtime dependencies).
- **Waiting on you:** pull requests open a week or more, open issues, and a
  note when nothing has been released for 60 days.
- **Reach:** downloads per registry, pub.dev likes, GitHub stars and forks, and
  issues or pull requests from other people that week.

The title says "all clear" or how many problems it found, so a green week is a
one-line read. To see a report without opening an issue, run the workflow by
hand from the Actions tab with **dry run** ticked: the report appears in the
run's summary.

What it can't see: the portfolio site (its repository is private, and the
workflow's token reads only this one) and its CMS figures, and whether a
registry's credentials are about to lapse (npm's trusted publisher, the Maven
token and signing key aren't readable from a workflow).
