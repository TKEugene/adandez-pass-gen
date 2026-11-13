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
2. **Logo**: copy your logo into `src/` (for example `src/logo.svg`). In `src/index.html`, replace
   `<span class="logo-mark" aria-hidden="true">A</span><span>Adandez</span>`
   with
   `<img src="logo.svg" alt="Adandez">`
3. `k8s/app/ingress.yaml`: see step 8 about the TLS block.

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
git remote add origin git@github.com:tkeugene/adandez-pass-gen.git
git push -u origin main
```

Watch it under the repo's **Actions** tab. The first run builds, tests, pushes `…/adandez-pass-gen:sha-xxxxxxx` to Docker Hub, then deploys. Check the cluster:

```bash
kubectl -n adandez-pass-gen get deploy,pods,svc,ingress
kubectl -n adandez-pass-gen rollout status deployment/adandez-pass-gen
```

## 8. Ingress, DNS and HTTPS (already handled for adandez.com)

`k8s/app/ingress.yaml` adds `/random-pass-gen` on `adandez.com` and `www.adandez.com`, alongside the existing WordPress (`/`), `/kb` and `/ssl` ingresses. ingress-nginx always picks the longest matching path, so this one wins over WordPress's `/`.

- **DNS: nothing to do.** The domain already points at your ingress controller.
- **Certificate: nothing to do.** The existing `adandez-tls` secret in the `adandez` namespace is already served for this host. The new ingress intentionally has no `tls:` block, so there is no second certificate and no conflict. `force-ssl-redirect` makes plain `http://` URLs redirect to HTTPS.
- **Why a separate namespace?** The deploy account in `k8s/bootstrap/` can only touch the `adandez-pass-gen` namespace. Putting the app in `adandez` would let GitHub modify your WordPress and `/kb` resources.

## 9. Verify

```bash
curl -I https://adandez.com/random-pass-gen/      # 200 + security headers
curl -I https://adandez.com/random-pass-gen       # 301 -> /random-pass-gen/
```

Then open the page, press Copy, and paste somewhere to confirm.

---

## Day to day: how updates work

Edit anything → commit → push to `main`. Pipeline: build → smoke test → push image → apply manifests → wait for the rollout. The rollout is zero-downtime (`maxUnavailable: 0`). If the new pods don't become healthy within 3 minutes, the pipeline **automatically rolls back** to the previous version and shows red.

Work through pull requests: they run the build and smoke test but never push or deploy. In **Settings → Branches**, require a pull request and the check *Build, test, push image* before merging into `main`.

**Roll back manually**
- Best: `git revert <bad-commit>` and push (keeps Git as the source of truth).
- Emergency: `kubectl -n adandez-pass-gen rollout undo deployment/adandez-pass-gen`

**See what version is live**
`kubectl -n adandez-pass-gen get deploy adandez-pass-gen -o jsonpath='{.spec.template.spec.containers[0].image}'`

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Error: Cannot perform an interactive login` in Actions | `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` missing or wrong |
| `Unable to connect to the server` in deploy job | API server not reachable from GitHub, or wrong `KUBE_SERVER` |
| `x509: certificate is valid for …, not <ip>` | The API server's certificate doesn't list that IP. Add it (`tls-san` in the K3s/RKE2 config, then restart) or use a hostname that is listed |
| `forbidden` / `x509` errors | Wrong `KUBE_TOKEN` / `KUBE_CA_B64`, or you skipped `deployer-rbac.yaml` |
| Pods `ImagePullBackOff` | Docker Hub repo is private (see below), or the username/repo name is wrong |
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
