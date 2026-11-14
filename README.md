# adandez-pass-gen

Client-side random password generator, served at **https://adandez.com/random-pass-gen**.

Passwords are generated in the visitor's browser with `crypto.getRandomValues`. Nothing is stored or transmitted, and the container only serves static files.

```
push to main ─► GitHub Actions ─► build + smoke test ─► push image to Docker Hub (sha-xxxxxxx)
                                                      └► kubectl apply -k k8s/app ─► rolling update ─► auto-rollback on failure
```

## Repo layout

```
src/                  index.html, style.css, app.js  (the website)
nginx/default.conf    web server config (security headers, /healthz, /random-pass-gen/ route)
Dockerfile            nginx-unprivileged, non-root, port 8080
k8s/bootstrap/        namespace + deploy permissions. Applied ONCE by you (admin)
k8s/app/              deployment, service, ingress, PDB, kustomization. Applied by CI on every push
k8s/optional/         NetworkPolicy. Applied by hand if you want it
.github/workflows/    CI/CD pipeline
.github/dependabot.yml  weekly PRs for base-image and GitHub Action updates
```

## Prerequisites

- A Kubernetes cluster (1.24+) with an **ingress controller** (these manifests assume ingress-nginx), and `kubectl` on your computer pointed at it
- The cluster's **API server reachable from the internet** on its direct address, usually `https://<node-ip>:6443` (GitHub's runners need to talk to it; see the Rancher note in step 3 and "Private cluster?" at the bottom)
- A GitHub account, a Docker Hub account, and `git`
- Optional: Docker, to test locally

Do the steps **in this order**. The pipeline needs the secrets to exist before the first push.

---

## 1. Create the Docker Hub repository and token

1. Docker Hub → **Create repository** → name `adandez-pass-gen`, visibility **Public** (it only contains a static page; public avoids pull secrets).
2. Docker Hub → Account settings → **Personal access tokens** → **Generate new token**, permission **Read & Write**. Copy it now; it is shown once.

## 2. Create the empty GitHub repository

GitHub → **New repository** → name `adandez-pass-gen`. Leave it **empty**: no README, no .gitignore, no license. Private or public both work.

## 3. Prepare the cluster (one time, as an admin)

```bash
kubectl apply -f k8s/bootstrap/namespace.yaml
kubectl apply -f k8s/bootstrap/deployer-rbac.yaml
```

This creates the `adandez-pass-gen` namespace and a `github-deployer` account that can only manage this app's Deployment, Service, Ingress and PDB inside that namespace. It cannot read secrets, delete anything, or touch other namespaces.

Confirm it is locked down:

```bash
SA=system:serviceaccount:adandez-pass-gen:github-deployer
kubectl auth can-i patch deployments -n adandez-pass-gen --as=$SA   # yes
kubectl auth can-i get secrets       -n adandez-pass-gen --as=$SA   # no
kubectl auth can-i get pods          -n kube-system      --as=$SA   # no
```

Collect the three values GitHub needs:

```bash
# KUBE_SERVER
kubectl config view --minify --raw -o jsonpath='{.clusters[0].cluster.server}'; echo

# KUBE_CA_B64  (already base64, paste as is)
kubectl -n adandez-pass-gen get secret github-deployer-token -o jsonpath='{.data.ca\.crt}'; echo

# KUBE_TOKEN
kubectl -n adandez-pass-gen get secret github-deployer-token -o jsonpath='{.data.token}' | base64 -d; echo
```


> **Using Rancher?** Your `kubectl` context may point at the Rancher proxy (a URL like `https://rancher.example.com/k8s/clusters/c-xxxxx`). **Do not use that URL for `KUBE_SERVER`**: the deploy token and CA above belong to the cluster itself, not to Rancher. Use the cluster's direct API address instead, for example `https://156.67.31.71:6443` (any control-plane node IP; K3s and RKE2 both use port 6443). Check it from your own computer first:
> ```bash
> curl -k https://156.67.31.71:6443/version     # should return JSON (401 is fine too)
> ```
> If that times out, port 6443 is firewalled. Open it for GitHub's runners, or use the pull-based option under "Private cluster?" below.

Test the token **before** putting it in GitHub (it must print a list of pods or `\"items\": []`, not `Unauthorized`):

```bash
TOKEN=$(kubectl -n adandez-pass-gen get secret github-deployer-token -o jsonpath='{.data.token}' | base64 -d)
echo "${TOKEN:0:3}"        # must print: eyJ
curl -sk -H "Authorization: Bearer $TOKEN" \
  https://156.67.31.71:6443/api/v1/namespaces/adandez-pass-gen/pods | head -5
```

`Unauthorized` means a bad token or the wrong cluster. `Forbidden` means the token works but `deployer-rbac.yaml` wasn't applied. If `echo` prints nothing, the cluster hasn't filled in the token: delete the secret (`kubectl -n adandez-pass-gen delete secret github-deployer-token`) and apply `deployer-rbac.yaml` again.

Tip: with the GitHub CLI you can skip copy and paste entirely:
`kubectl -n adandez-pass-gen get secret github-deployer-token -o jsonpath='{.data.token}' | base64 -d | gh secret set KUBE_TOKEN`

## 4. Add the GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Add all five:

| Name | Value |
|---|---|
| `DOCKERHUB_USERNAME` | your Docker Hub username |
| `DOCKERHUB_TOKEN` | the token from step 1 |
| `KUBE_SERVER` | API server URL from step 3 |
| `KUBE_CA_B64` | CA value from step 3 |
| `KUBE_TOKEN` | token from step 3 |

Optional but recommended: **Settings → Environments → New environment** called `production`, and add yourself as a *required reviewer* if you want to approve each deploy manually.

## 5. Personalise the repo files

1. `Dockerfile`: replace `YOUR_GITHUB_USERNAME` in the `source` label.
2. **Logo**: put your logo file in `src/` and name it `logo.png`. Use a **square** image, at least 256 x 256 px. It is shown inside a round frame at the top-left of the header and, smaller, in the footer, both from this one file. For a different name or format (for example `logo.svg` or `logo.webp`), change the single line `--logo:url("logo.png");` at the top of `src/style.css`. If the file is missing or misnamed the page still works and shows an empty round frame.
3. `k8s/app/ingress.yaml`: nothing to change for adandez.com (see step 9).

## 6. Test locally (optional, needs Docker)

```bash
docker build -t adandez-pass-gen .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp adandez-pass-gen
# open http://localhost:8080/random-pass-gen/
```

## 7. Push to GitHub

```bash
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/adandez-pass-gen.git
git push -u origin main
```

Watch it under the repo's **Actions** tab. The first run builds, tests, pushes `…/adandez-pass-gen:sha-xxxxxxx` to Docker Hub, then deploys the manifests (explained in step 8). Check the cluster:

```bash
kubectl -n adandez-pass-gen get deploy,pods,svc,ingress
kubectl -n adandez-pass-gen rollout status deployment/adandez-pass-gen
```

## 8. Deploying the manifests

Which manifest gets applied by whom:

| File | Creates | Applied by |
|---|---|---|
| `k8s/bootstrap/namespace.yaml` | the `adandez-pass-gen` namespace | **you**, once (step 3) |
| `k8s/bootstrap/deployer-rbac.yaml` | the limited GitHub deploy account and its token | **you**, once (step 3) |
| `k8s/app/deployment.yaml` | the app: 2 pods, rolling updates, health checks, locked-down security settings | **the pipeline**, every push |
| `k8s/app/service.yaml` | internal Service that the ingress sends traffic to | **the pipeline**, every push |
| `k8s/app/ingress.yaml` | the `/random-pass-gen` route on adandez.com and www | **the pipeline**, every push |
| `k8s/app/pdb.yaml` | keeps at least 1 pod up during node maintenance | **the pipeline**, every push |
| `k8s/app/kustomization.yaml` | ties the four files above together and sets the exact image tag | **the pipeline** (it rewrites the tag) |
| `k8s/optional/networkpolicy.yaml` | extra network lockdown | **you**, only if you want it |

### Automatic (normal path)

You never run `kubectl apply` for the app yourself. After the image is pushed, the pipeline's **Deploy to Kubernetes** job does this:

1. Connects to the cluster with the `github-deployer` token.
2. Writes the new image tag (`sha-xxxxxxx`) into `k8s/app/kustomization.yaml`.
3. Runs `kubectl apply -k k8s/app`, which creates (first run) or updates (later runs) the Deployment, Service, Ingress and PodDisruptionBudget.
4. Waits for the rollout (`kubectl rollout status`) and rolls back if it fails.

Confirm after the first run:

```bash
kubectl -n adandez-pass-gen get deploy,pods,svc,ingress,pdb
```

### Manual (first deploy by hand, or if GitHub cannot reach your cluster)

The image must already be on Docker Hub. The pipeline's build job pushes it even when the deploy job fails, and the tag is printed in the Actions log (for example `sha-3f9a1c2`). Then, from the repo folder on your computer:

```bash
# 1. Point the manifests at that image: edit newName and newTag in k8s/app/kustomization.yaml
#      newName: YOUR_DOCKERHUB_USERNAME/adandez-pass-gen
#      newTag:  sha-3f9a1c2

# 2. Preview what will be created (nothing is changed yet)
kubectl kustomize k8s/app

# 3. Deploy
kubectl apply -k k8s/app

# 4. Watch it come up
kubectl -n adandez-pass-gen rollout status deployment/adandez-pass-gen
kubectl -n adandez-pass-gen get deploy,pods,svc,ingress,pdb
```

Later pushes overwrite those two lines automatically, so there is no need to commit your edit.

## 9. Ingress, DNS and HTTPS (already handled for adandez.com)

`k8s/app/ingress.yaml` adds `/random-pass-gen` on `adandez.com` and `www.adandez.com`, alongside the existing WordPress (`/`), `/kb` and `/ssl` ingresses. ingress-nginx always picks the longest matching path, so this one wins over WordPress's `/`.

- **DNS: nothing to do.** The domain already points at your ingress controller.
- **Certificate: nothing to do.** The existing `adandez-tls` secret in the `adandez` namespace is already served for this host. The new ingress intentionally has no `tls:` block, so there is no second certificate and no conflict. `force-ssl-redirect` makes plain `http://` URLs redirect to HTTPS.
- **Why a separate namespace?** The deploy account in `k8s/bootstrap/` can only touch the `adandez-pass-gen` namespace. Putting the app in `adandez` would let GitHub modify your WordPress and `/kb` resources.

## 10. Verify

```bash
curl -I https://adandez.com/random-pass-gen/      # 200 + security headers
curl -I https://adandez.com/random-pass-gen       # 301 -> /random-pass-gen/
```

Then open the page, press Copy, and paste somewhere to confirm.

---

## Customising the page

| I want to change | Edit |
|---|---|
| The elephant mascot | It is an inline SVG (`<svg class="elephant">`) inside `<div class="hero-wrap">` in `src/index.html`, animated by the `.elephant` rules at the bottom of `src/style.css`. To use your own picture instead, put it in `src/` and replace the whole `<svg class="elephant" ...>...</svg>` block with `<img class="elephant" src="hero.png" alt="Describe the image">`. |
| Logo (header and footer) | `--logo:url("logo.png");` at the very top of `src/style.css`. Sizes are in the `.logo-img` rules at the bottom of that file (52px in the header, 40px in the footer). To remove the "Adandez" word beside the logo, delete the `<span class="logo-text">Adandez</span>` in `src/index.html` (header and/or footer) |
| Top menu links | `<nav class="nav" id="site-nav">` in `src/index.html` (one `<a>` per link). Seven links fit on one line from 1280px wide; narrower screens get the menu button automatically |
| Footer links | the `<nav>` blocks inside `<footer>` in `src/index.html` |
| The "Share it securely" hint under the options | `<p class="share-hint">` in `src/index.html` (delete the line to remove it) |
| Footer year | nothing. It is filled in from the visitor's clock, so it changes every 1 January on its own |
| Page background and colours | the variables at the very top of `src/style.css`: `--bg` is the page colour, `--glow` the soft top glow, `--brand` the button/accent colour, `--foot-bg` the footer. A second block right below holds the dark-mode versions |
| The "Copied" bubble | text and timing are in `showCopied()` in `src/app.js`; look in `style.css` under `.copied` |

External links open in a new tab. Affiliate links (Cheap VPS, Dedicated Server) carry `rel="sponsored"`, and the footer shows a short affiliate disclosure. The site sends only its origin (`https://adandez.com`, never the page path) to the sites you link to, so they can see visits coming from adandez.com in their analytics.

## Day to day: how updates work

Edit anything → commit → push to `main`. Pipeline: build → smoke test → push image → apply manifests → wait for the rollout. The rollout is zero-downtime (`maxUnavailable: 0`). If the new pods don't become healthy within 3 minutes, the pipeline **automatically rolls back** to the previous version and shows red.

Work through pull requests: they run the build and smoke test but never push or deploy. In **Settings → Branches**, require a pull request and the check *Build, test, push image* before merging into `main`.

**Roll back manually**
- Best: `git revert <bad-commit>` and push (keeps Git as the source of truth).
- Emergency: `kubectl -n adandez-pass-gen rollout undo deployment/adandez-pass-gen`

**See what version is live** (the page also carries the full commit id in `<meta name="build">`)
`kubectl -n adandez-pass-gen get deploy adandez-pass-gen -o jsonpath='{.spec.template.spec.containers[0].image}'`

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Error: Cannot perform an interactive login` in Actions | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` missing or wrong |
| `lookup … no such host`, or the URL in the error starts with `http://` | `KUBE_SERVER` is not `https://<node-ip>:6443`. It is missing `https://`, missing the port, or is a name that doesn't resolve publicly (Rancher URL, `kubernetes`, a local alias). Fix the secret, then **Re-run failed jobs** |
| `Please enter Username:` then `error: EOF` | The server was reached but rejected `KUBE_TOKEN` (empty, still base64-encoded, or from a different cluster). Re-create it as in step 3 and check it with the curl test below |
| `Unable to connect to the server` in deploy job | API server not reachable from GitHub, or wrong `KUBE_SERVER` |
| `x509: certificate is valid for …, not <ip>` | The API server's certificate doesn't list that IP. Add it (`tls-san` in the K3s/RKE2 config, then restart) or use a hostname that is listed |
| `forbidden` / `x509` errors | Wrong `KUBE_TOKEN` / `KUBE_CA_B64`, or you skipped `deployer-rbac.yaml` |
| Pods `ImagePullBackOff` | Docker Hub repo is private (see below), or the username/repo name is wrong |
| Page looks unstyled, or old and new design are mixed | A stale copy of `style.css` is being served from somewhere (browser, service worker, CDN or WordPress cache plugin). Each build now stamps its id into the CSS/JS addresses, so a fresh deploy always loads fresh files. To check what is live: `curl -s https://adandez.com/random-pass-gen/ \| grep -E 'name="build"\|style.css'` (the build id should equal the commit you pushed). If it still looks wrong in one browser only, use Ctrl+Shift+R, or DevTools → Application → Storage → **Clear site data** |
| Browser certificate warning on this path only | Check `kubectl -n adandez get ingress` still shows your existing `adandez-tls` ingresses; this app adds no certificate of its own |
| 404 from the ingress controller | Host/path mismatch, or `ingressClassName` differs from your controller's class |
| 502 / 503 | Pods not ready: `kubectl -n adandez-pass-gen describe pod` |

**Private Docker Hub repo?** Create a pull secret and add it to the Deployment:
```bash
kubectl -n adandez-pass-gen create secret docker-registry regcred \
  --docker-username=YOU --docker-password=YOUR_TOKEN
```
then add `imagePullSecrets: [{name: regcred}]` under `spec.template.spec` in `deployment.yaml`.

**ARM nodes** (Graviton, Raspberry Pi, Ampere)? In the workflow's *Push image* step add `platforms: linux/amd64,linux/arm64` and a `docker/setup-qemu-action@v4` step before buildx.

**Private cluster?** If the API server isn't public, GitHub-hosted runners can't deploy. Use a self-hosted runner inside your network, or pull-based GitOps with Argo CD or Flux watching this repo and Docker Hub.

## Security notes

- Strict Content-Security-Policy: only this site's own scripts and styles run, and the page cannot make network requests (`connect-src 'none'`), so even a compromised dependency could not send a password anywhere.
- Containers run as non-root, with a read-only filesystem, all Linux capabilities dropped, and the restricted pod security profile enforced.
- The deploy credential is a single-namespace account with no access to secrets.
- `Strict-Transport-Security` is intentionally not set here: it applies to the whole `adandez.com` domain, so enable it at your main site / ingress once everything on the domain is HTTPS.
- Optional: apply `k8s/optional/networkpolicy.yaml` so only the ingress controller can reach the pods (edit the controller's namespace first).
