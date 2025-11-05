# Automated Release Process for Wendy VSCode Extension

This document explains how to use the automated GitHub Actions workflow to release new versions of the Wendy VSCode extension.

## Release Methods

There are two ways to release a new version of the extension:

1. **Automatic Release (Recommended)**: Simply update the version in `package.json` and commit to the main branch.
2. **Manual Trigger**: Use the GitHub Actions workflow dispatch to trigger a release with custom version bumping.

## Prerequisites

Before you can use the automated release process, you need to set up a few things:

1. **Visual Studio Marketplace Personal Access Token (PAT)**:
   - Go to [Azure DevOps](https://dev.azure.com)
   - Click on your profile picture in the top right and select "Personal access tokens"
   - Create a new token with the "Marketplace (publish)" scope
   - Add this token as a GitHub repository secret named `VSCE_PAT`

## Automatic Release (Version Commit)

To automatically release a new version:

1. Update the version number in `package.json`
2. Commit and push to the main branch
3. The GitHub Actions workflow will automatically:
   - Detect the version change
   - Build and package the extension
   - Create a Git tag (if not already existing)
   - Publish to the Visual Studio Marketplace
   - Create a GitHub Release with the .vsix file attached

Example:
```bash
# Edit package.json to change version from "0.0.5" to "0.0.6"
git add package.json
git commit -m "Bump version to 0.0.6"
git push origin main
```

## Manual Triggering a Release

You can also manually trigger a release:

1. Go to the **Actions** tab in your GitHub repository
2. Select the **Release Extension** workflow from the sidebar
3. Click the **Run workflow** button
4. Configure the release:
   - **Version to release**: 
     - Leave empty or select "patch" to increment the patch version (e.g., 0.0.5 -> 0.0.6)
     - Select "minor" to increment the minor version (e.g., 0.0.5 -> 0.1.0)
     - Select "major" to increment the major version (e.g., 0.0.5 -> 1.0.0)
     - Or specify a specific version number
   - **Dry run**: Check this to test the workflow without actually publishing to the marketplace
5. Click **Run workflow**

## What the Workflow Does

The automated workflow performs these steps:

1. Checks out the repository code
2. Sets up Node.js
3. Installs dependencies
4. For manual triggers: Increments the version in package.json based on your selection
5. For automatic triggers: Uses the version you committed in package.json
6. Builds the extension
7. Packages the extension into a .vsix file
8. Creates a Git tag for the release
9. Publishes the extension to the Visual Studio Marketplace
10. Creates a GitHub Release with the .vsix file attached

## Manual Publishing

If you need to publish manually without GitHub Actions, you can still follow these steps:

1. Increment the version in package.json
2. Run `npm install` to update package-lock.json
3. Run `npm run package` to build the extension
4. Run `vsce package` to create the .vsix file
5. Upload the .vsix file to [VS Code Marketplace](https://marketplace.visualstudio.com/manage/publishers/edge-engineer) 