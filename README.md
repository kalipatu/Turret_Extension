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
DAPP contains 2 examples of the compiled move contract, which can be directly authorized on your turret.
- First one force turret to attack all exept you as owner
- Second one force turret to attack all exept you as owner and whole initial corp (clonebank 86)

You can adjust the logic in move-contracts/turret/turret_config/sources/turret_config.move

Afterwards compile the project 
```bash
  sui move build --dump-bytecode-as-base64 > bytecode_dump.json
```
and copy neccessary files to dapp with the script
```bash
  ./copy_bytecode.sh
```
Than you can deploy the contract to the SUI and use it for authorisation to your turrets


<img width="1038" height="1003" alt="grafik" src="https://github.com/user-attachments/assets/a84746ca-8710-4a61-95bd-d1150db8e969" />
<img width="521" height="968" alt="grafik" src="https://github.com/user-attachments/assets/5f2c9e89-de85-47fc-9617-94fa20dd86c0" />
<img width="1168" height="970" alt="grafik" src="https://github.com/user-attachments/assets/23fffa46-b314-4d0c-9b29-21b41e377b7e" />
<img width="1032" height="1125" alt="grafik" src="https://github.com/user-attachments/assets/e2e008cd-654c-4177-bf6e-366ed941c483" />
<img width="702" height="948" alt="grafik" src="https://github.com/user-attachments/assets/78081879-8e11-4908-8141-a58ece30ef88" />
<img width="1034" height="1125" alt="grafik" src="https://github.com/user-attachments/assets/6a1ae2e5-a557-4e20-ae05-e6011fca075d" />
<img width="1785" height="402" alt="grafik" src="https://github.com/user-attachments/assets/c260e06a-ac1b-4df2-a9c7-bcfc05d5b11e" />





