#!/usr/bin/env bash
# Zet een release in de Home Assistant-app-repo: versie in dingen/config.yaml en
# de changelog-sectie bovenaan dingen/CHANGELOG.md. Home Assistant ziet de nieuwe
# versie en toont een update-melding. Draait pas na een geslaagd image.
# Gebruik: ha-addon.sh <versie>   (deploy-key in $DEPLOY_KEY)
# Zonder deploy-key (geen secret, bijvoorbeeld in een fork) slaat hij over.
set -euo pipefail
version="$1"
repo="${HA_ADDON_REPO:-git@github.com:KleijnICT/dingen-app-ha-addon.git}"

if [ -z "${DEPLOY_KEY:-}" ]; then
  echo "Geen deploy-key ingesteld; Home Assistant-app niet bijgewerkt."
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
install -m 600 /dev/null "$work/key"
printf '%s\n' "$DEPLOY_KEY" > "$work/key"
export GIT_SSH_COMMAND="ssh -i $work/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

git clone --depth 1 "$repo" "$work/repo"
notes=$(awk -v v="## $version" '$0 ~ "^## " { if (found) exit; if (index($0, v) == 1) { found = 1; next } } found' CHANGELOG.md)

cd "$work/repo"
sed -i.bak -E "s/^version: .*/version: \"$version\"/" dingen/config.yaml && rm dingen/config.yaml.bak
if ! grep -q "^## $version\$" dingen/CHANGELOG.md; then
  {
    head -n 2 dingen/CHANGELOG.md
    printf '## %s\n%s\n\n' "$version" "$notes"
    tail -n +3 dingen/CHANGELOG.md
  } > dingen/CHANGELOG.new
  mv dingen/CHANGELOG.new dingen/CHANGELOG.md
fi

if git diff --quiet; then
  echo "Home Assistant-app staat al op $version."
  exit 0
fi
git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -qam "Dingen $version"
git push origin HEAD
echo "Home Assistant-app bijgewerkt naar $version."
