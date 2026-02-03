# usrpkg-builder

A Flatpak repository mirroring tool for managing local Flatpak repositories, originally created for splashos.

## Overview

`usrpkg-builder` is a Node.js tool that downloads and mirrors Flatpak applications from Flathub (or other remotes) to a local OSTree repository. It uses the `libflatpak` npm package for Flatpak integration and provides a configurable, automated way to create and maintain local Flatpak repositories.

## Features

- **Full Flathub Mirroring**: Download all available Flatpak applications from Flathub
- **Configurable Architecture**: Target specific architectures (x86_64, i386, etc.)
- **Package Limiting**: Optionally limit the number of packages mirrored for testing
- **AppStream Metadata**: Downloads and parses AppStream data for package information
- **Repository Management**: Creates, configures, and maintains OSTree repositories
- **Batch Processing**: Downloads packages in configurable batches for optimal performance
- **Retry Logic**: Automatic retries for failed downloads with exponential backoff
- **Repository Optimization**: Generates static deltas and repository summaries

## Installation

### Prerequisites

- Node.js 18 or higher
- Flatpak installed on the system
- Flatpak development libraries (`flatpak-devel` on Fedora/RHEL, `libflatpak-dev` on Debian/Ubuntu)

### Setup

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd usrpkg-builder
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Ensure Flatpak is installed and configured:
   ```bash
   flatpak --version
   ```

## Configuration

Configuration is managed through `config.yaml`:

```yaml
# Repository configuration
repo_path: ./usrpkg-repo           # Path where the OSTree repository will be created
appstream_url: https://dl.flathub.org/repo/appstream/x86_64/appstream.xml.gz  # AppStream metadata URL
architecture: x86_64               # Target architecture
remote_name: flathub               # Remote repository name
remote_url: https://dl.flathub.org/repo/  # Remote repository URL
max_packages: 0                    # Maximum packages to mirror (0 = all packages)
```

### Configuration Options

- `repo_path`: Local filesystem path for the OSTree repository
- `appstream_url`: URL to download AppStream metadata (contains package descriptions)
- `architecture`: Target CPU architecture (e.g., x86_64, i386, aarch64)
- `remote_name`: Name of the remote Flatpak repository to mirror
- `remote_url`: URL of the remote repository
- `max_packages`: Limit the number of packages mirrored (useful for testing)

## Usage

### Basic Mirroring

To start mirroring packages from Flathub:

```bash
node index.js
```

The tool will:
1. Create or open the repository at the configured path
2. Configure the Flathub remote (with GPG verification disabled for mirroring)
3. Fetch the list of available packages
4. Download AppStream metadata
5. Mirror packages in batches
6. Optimize the repository and generate summaries

### Custom Repository Location

To use a custom repository location, update `config.yaml`:

```yaml
repo_path: /path/to/your/repository
```

### Limiting Packages for Testing

To test with a limited number of packages:

```yaml
max_packages: 10  # Only mirror 10 packages
```

### Using the Mirrored Repository

Once the repository is created, you can use it as a Flatpak remote:

```bash
# Add the local repository as a remote
flatpak remote-add --user --no-gpg-verify usrpkg file://$(pwd)/usrpkg-repo

# Install applications from the local repository
flatpak install --user usrpkg org.gnome.Calculator
```

## How It Works

### Architecture

`usrpkg-builder` consists of three main components:

1. **Configuration Management** (`utils/config.js`): Loads and validates configuration from `config.yaml`
2. **libflatpak Bindings**: JavaScript bindings to libflatpak for native Flatpak integration (pure bindings approach for all operations)
3. **Mirroring Engine** (`mirror/libflatpakMirror.js`): Main mirroring logic using pure libflatpak bindings

### Mirroring Process

1. **Repository Setup**: Creates or opens an OSTree repository at the configured path using libflatpak bindings
2. **Remote Configuration**: Adds and configures the remote repository (Flathub by default) using pure libflatpak bindings
3. **Package Discovery**: Fetches the list of available packages using `libflatpak` bindings
4. **Metadata Download**: Downloads and parses AppStream XML for package information
5. **Package Mirroring**: Downloads packages in batches with retry logic using libflatpak transactions
6. **Repository Optimization**: Generates static deltas and updates repository summary

### Key Features Implementation

- **Pure Bindings Approach**: Uses libflatpak bindings for all operations without CLI fallbacks
- **Batch Processing**: Packages are downloaded in configurable batches (default: 5) to balance performance and resource usage
- **Retry Logic**: Failed downloads are retried up to 3 times with exponential backoff
- **Error Handling**: Detailed error reporting with failed package tracking
- **Progress Reporting**: Real-time progress updates during mirroring
- **Binding Fixes**: All known binding issues have been resolved, enabling full functionality

## Repository Structure

After successful mirroring, the repository will have the following structure:

```
usrpkg-repo/
├── repo/                    # OSTree repository
│   ├── config              # Repository configuration
│   ├── objects/            # OSTree objects (packages, metadata)
│   ├── refs/               # References to objects
│   └── tmp/                # Temporary files
├── appstream/              # AppStream metadata
│   └── x86_64/             # Architecture-specific metadata
├── .changed                # Change tracking file
└── README.md               # Repository information
```

## Troubleshooting

### libflatpak Binding Status

The `libflatpak` npm package bindings have been fully fixed and now provide complete functionality for Flatpak mirroring:

**What works with libflatpak bindings:**
- ✅ Reading system information (`getDefaultArch()`, `getSupportedArches()`)
- ✅ Listing system installations and remotes
- ✅ Fetching package lists and metadata
- ✅ Reading package properties (name, architecture, size, etc.)
- ✅ Creating remotes with `Remote.create()`
- ✅ Creating transactions with `Transaction.create()`
- ✅ Installation path access with proper string conversion
- ✅ Property accessors using correct camelCase method names
- ✅ Multiple constructor methods available
- ✅ GBytes parameter handling for flatpakref data
- ✅ Full package installation via transactions

**Key binding fixes implemented:**
1. **GObject Parameter Handling**: Accepts both external objects and wrapper objects with `_native` property
2. **Multiple Constructor Support**: All constructors properly exported (e.g., `Remote.create()`, `Remote.createFromFile()`)
3. **Property Getter/Setter Fixes**: Uses correct camelCase method names (e.g., `getName()` not `get_name()`)
4. **GLib.Bytes Parameter Handling**: Converts JavaScript Buffer objects to GBytes*
5. **Gio.File to String Conversion**: `getPath()` returns string instead of external object
6. **Wrapper Object Support**: All methods accept wrapper objects as parameters

**Pure Binding Approach:**
The tool now uses 100% libflatpak bindings without CLI fallbacks, enabling a pure JavaScript solution for Flatpak repository mirroring.

### Common Issues

1. **GPG Verification Errors**: The tool disables GPG verification by default. If you need verification, install Flathub's GPG key first.

2. **Missing Flatpak Development Libraries**: Ensure `flatpak-devel` or `libflatpak-dev` is installed.

3. **Permission Errors**: The tool creates repositories in user space. Ensure you have write permissions to the target directory.

4. **Network Issues**: The tool requires network access to download packages. Check your connection and firewall settings.

### Debugging

Enable verbose output by adding debug logging to the code or running with `DEBUG=* node index.js`.

## Performance Considerations

- **Disk Space**: Mirroring all Flathub packages requires significant disk space (hundreds of GBs)
- **Network Bandwidth**: Downloading all packages requires substantial bandwidth
- **Memory Usage**: Processing AppStream data requires sufficient RAM
- **Time**: Full mirroring can take many hours depending on network speed

## Development

### Project Structure

```
usrpkg-builder/
├── index.js                 # Main entry point
├── config.yaml             # Configuration file
├── package.json            # Node.js dependencies
├── utils/                  # Utility modules
│   ├── config.js          # Configuration loader
│   ├── flatpakLib.js      # libflatpak-based utilities
│   └── db.js              # Database utilities (unused)
├── mirror/                 # Mirroring functionality
│   ├── libflatpakMirror.js # Pure bindings mirroring logic
│   └── fetchAppstream.js  # AppStream fetching
└── node_modules/          # Dependencies
```

### Adding New Features

1. **New Configuration Options**: Add to `config.yaml` and update `utils/config.js`
2. **Additional Remotes**: Extend the remote configuration logic in `mirror/libflatpakMirror.js`
3. **Custom Filters**: Modify the package filtering logic in the mirroring functions
4. **Progress Reporting**: Enhance the batch processing with more detailed progress

## License

ISC License

## Contributing

Contributions are welcome! Please submit pull requests or open issues for bugs and feature requests.

## Acknowledgments

- Built with the `libflatpak` npm package for Flatpak integration
- Uses Flathub as the default remote repository
- Inspired by the needs of splashos for local Flatpak repositories