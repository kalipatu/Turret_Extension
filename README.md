This is a project for creation and deployment of the Turret Extension to customise the default behaviour of the Smart Turrets of EVE Frontier.

Prerequisites for DAPP local exectution:
    Tested on Linux
    pnpm (to Install "npm i -g pnpm")
On the computer in local network, where the DAPP will be executed
    Chrome with Chrome extension Sui Wallet EVE Vault (install it following official docu https://docs.evefrontier.com/eve-vault/browser-extension)

For customising the SUI Move contract, install 
    Sui CLI (suiup is recommended for easy upgrades on sui version, https://docs.sui.io/guides/developer/getting-started/sui-install)


    

## Quick Start



```bash
# Clone the repository
git clone https://github.com/kalipatu/Turret_Extension.git

# if yo want to redact and build your own extension, you need the world-contract for correct references
git clone https://github.com/evefrontier/world-contracts.git

# Navigate to the dapps directory
cd Turret_Extension/dapps

# Install dependencies
pnpm install

# Start development server
pnpm dev --host

# Open http://localhost:5173 in your browser


# To compile your own Move contracts:
cd move-contracts/turret/turret_config

# this command will create the .mv file and dump file with digest info
sui move build --dump-bytecode-as-base64 > bytecode_dump.json

# copy the turret.mv file as well as dump info in correct directory for usage in DAPP (turret_extension/dapps/public/bytecode)
./copy_bytecode.sh
```
