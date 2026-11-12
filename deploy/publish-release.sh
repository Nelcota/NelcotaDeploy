#!/usr/bin/env bash
set -euo pipefail

readonly tag=${1:?pass the release tag}
readonly archive=nelcota-deploy.tar.gz
readonly checksum="$archive.sha256"
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT

if ! release=$(gh release view "$tag" --json assets,isDraft); then
  gh release create "$tag" --verify-tag --generate-notes --draft
  release=$(gh release view "$tag" --json assets,isDraft)
fi

archive_exists=$(jq -er --arg name "$archive" 'any(.assets[]; .name == $name) | tostring' <<< "$release")
checksum_exists=$(jq -er --arg name "$checksum" 'any(.assets[]; .name == $name) | tostring' <<< "$release")
is_draft=$(jq -er '.isDraft | tostring' <<< "$release")

if [[ "$archive_exists" == true ]]; then
  # A previous attempt may have uploaded a different build of this tag. Hash the actual asset.
  gh release download "$tag" --pattern "$archive" --dir "$work_dir"
else
  cp -- "$archive" "$work_dir/"
  gh release upload "$tag" "$work_dir/$archive"
fi

if [[ "$checksum_exists" == true ]]; then
  gh release download "$tag" --pattern "$checksum" --output "$work_dir/existing.sha256"
fi

(cd -- "$work_dir" && sha256sum "$archive") > "$work_dir/$checksum"
if [[ "$checksum_exists" == false ]]; then
  gh release upload "$tag" "$work_dir/$checksum"
elif ! cmp -s "$work_dir/$checksum" "$work_dir/existing.sha256"; then
  gh release upload "$tag" "$work_dir/$checksum" --clobber
fi

if [[ "$is_draft" == true ]]; then
  gh release edit "$tag" --draft=false
fi
