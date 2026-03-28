import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TurretBehaviour } from './custom/Turret_Behaviour_v1';

const queryClient = new QueryClient();

const ensureCryptoRandomUUID = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return; // Already available
    }

    // Polyfill crypto.randomUUID if missing
    if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
        crypto.randomUUID = function () {
            // RFC4122 version 4 compliant UUID generator
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = Math.random() * 16 | 0;
                const v = c === 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        };
        console.log('crypto.randomUUID polyfilled for non-secure context');
    }
};

ensureCryptoRandomUUID();

function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <SuiClientProvider 
                networks={{ 
                    testnet: { 
                        url: 'https://fullnode.testnet.sui.io:443' 
                    } 
                }}
                defaultNetwork="testnet"
            >
                <WalletProvider>
                    <TurretBehaviour />
                </WalletProvider>
            </SuiClientProvider>
        </QueryClientProvider>
    );
}
export default App;