# jupydrive-s3

[![Github Actions Status](https://github.com/QuantStack/jupydrive-s3/workflows/Build/badge.svg)](https://github.com/QuantStack/jupydrive-s3/actions/workflows/build.yml)
A JupyterLab extension which enables client-side drives access.

![Screenshot from 2024-05-06 15-22-59](https://github.com/DenisaCG/jupydrive-s3/assets/91504950/c6912105-cc0b-4a95-9234-57faebe75b90)

The drives are used as a filesystem, having support for all basic functionalities (file tree-view, editing contents, copying, renaming, deleting, downloading etc).

The extension was built using the official JavaScript [`AWS SDK`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/).

## Drives Compatibility

Currently, the extension offers support only for [`S3`](https://aws.amazon.com/s3/) drives.

## Configuration

### Set `CORS` Rules

As the extension works in the browser, the `S3` buckets need to have certain `CORS` (Cross-Origin-Resource-Sharing) rules set:

- `http://localhost:*` needs to be added to the `AllowedOrigins` section,
- `GET`, `PUT`, `DELETE`, `HEAD` need to be added to the `AllowedMethods` section.

More information about `CORS` [here](https://docs.aws.amazon.com/AmazonS3/latest/userguide/cors.html) and the various ways to configure it [here](https://docs.aws.amazon.com/AmazonS3/latest/userguide/enabling-cors-examples.html).

## Requirements

- JupyterLab >= 4.0.0

## Install

To install the extension, execute:

```bash
pip install jupydrive_s3
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupydrive_s3
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupydrive_s3 directory
# Install package in development mode
pip install -e "."
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Local enviroment variables

For the local development of the extension, enviroment variables are used to define the required bucket name, region and endpoint, as well as the access key id and secret key, with the additional possibility of defining a different root folder.

Rename the `.env.example` file to `.env` and update it with the values needed for your local configuration.

Note: Unless configured differently, the `S3` bucket endpoint should follow the format: `https://s3.<bucket-region>.amazonaws.com`.

### Development uninstall

```bash
pip uninstall jupydrive_s3
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `jupydrive-s3` within that folder.

### Testing the extension

#### Frontend tests

This extension is using [Jest](https://jestjs.io/) for JavaScript code testing.

To execute them, execute:

```sh
jlpm
jlpm test
```

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro) for the integration tests (aka user level tests).
More precisely, the JupyterLab helper [Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to handle testing the extension in JupyterLab.

More information are provided within the [ui-tests](./ui-tests/README.md) README.

### Packaging the extension

See [RELEASE](RELEASE.md)
