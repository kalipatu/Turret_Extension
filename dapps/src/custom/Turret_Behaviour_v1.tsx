import { Box, Container, Flex, Text, Button, Card, Code, Spinner, Tabs, Badge, Select, RadioGroup } from "@radix-ui/themes";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useSuiClient, useWallets } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { bcs } from '@mysten/sui/bcs';

import { CopyableCode } from "./utils";

import "@radix-ui/themes/styles.css";

// World package address (testnet)
const WORLD_PACKAGE = "0x28b497559d65ab320d9da4613bf2498d5946b2c0ae3597ccfda3072ce127448c";
const GRAPHQL_ENDPOINT = 'https://graphql.testnet.sui.io/graphql';



const GET_OBJ_BY_TYPE = `
 query GetExcludedConfig($type: String!) {
    objects(filter: { type:  $type }) {
      nodes {
        address
        digest
        owner {
          __typename
          ... on Shared {
            initialSharedVersion
          }
        }
        asMoveObject {
          contents {
            json
          }
        }
      }
    }
  }
`;

const GET_ORIGINAL_PACKAGE = `
  query GetOriginalPackage($packageId: String!) {
    package(address: $packageId) {
      address
      version
      packageVersionsBefore(first: 1) {
        nodes {
          address
          version
        }
      }
    }
  }
`;

const GET_HISTORY_OF_PACKAGE = `
  query GetOriginalPackage($packageId: String!) {
    package(address: $packageId) {
      address
      version
      packageVersionsBefore {
        nodes {
          address
          version
        }
      }
    }
  }
`;

// Type definitions
const PLAYER_PROFILE_TYPE = `${WORLD_PACKAGE}::character::PlayerProfile`;
const OWNER_CAP_TYPE = `${WORLD_PACKAGE}::access::OwnerCap<${WORLD_PACKAGE}::turret::Turret>`;

// Add this type definition
interface BytecodeTemplate {
    name: string;
    description: string;
    filename: string;
    bytecode: number[] | null;
    digest?: number[];
}

interface PlayerProfile {
    id: string;
    characterId: string;
    char_item_id: string;
    tribe_id: string;
}

interface OwnerCap {
    id: string;
    assemblyId: string;
}

interface Turret {
    id: string;
    extension: string | null;
}

interface DeployedPackage {
    packageId: string;
    capId: string;
    version?: number;
}

interface BytecodeDump {
    modules: string[];
    dependencies: string[];
    digest?: number[];
}

interface ExcludedConfig {
    characterIds: number[];
    tribeIds: number[];
}

export function TurretBehaviour() {
    const account = useCurrentAccount();
    const suiClient = useSuiClient();
    const wallets = useWallets();

    // State
    const [deploying, setDeploying] = useState(false);
    const [upgrading, setUpgrading] = useState(false);
    const [packageId, setPackageId] = useState<string | null>(null);
    const [deployError, setDeployError] = useState<string | null>(null);
    const [bytecode, setBytecode] = useState<number[] | null>(null);
    const [bytecodeDump, setBytecodeDump] = useState<BytecodeDump | null>(null);
    const [templatesLoading, setTemplatesLoading] = useState(true);

    // Character and asset state
    const [playerProfile, setPlayerProfile] = useState<PlayerProfile | null>(null);
    const [characterAccount, setCharacterAccount] = useState<string | null>(null);
    const [characterID, setCharacterID] = useState<string>("");
    const [characterTribeID, setCharacterTribeID] = useState<string>("");

    const [ownerCaps, setOwnerCaps] = useState<OwnerCap[]>([]);
    const [turrets, setTurrets] = useState<Map<string, Turret>>(new Map());

    // UI state
    const [selectedTurret, setSelectedTurret] = useState<string | null>(null);
    const [authorizing, setAuthorizing] = useState(false);

    const [excludedCharacterIds, setExcludedCharacterIds] = useState<number[]>([]);
    const [excludedTribes, setExcludedTribes] = useState<number[]>([]);
    const [loadingExcluded, setLoadingExcluded] = useState(false);
    const [adminCapId, setAdminCapId] = useState<string | null>(null);
    const [excludedConfigId, setExcludedConfigId] = useState<string | null>(null);

    const [turretAuths, setTurretAuths] = useState<Map<string, string>>(new Map());
    const [packageVersionMap, setPackageVersionMap] = useState<Map<string, number>>(new Map());
    const [packageChainMap, setPackageChainMap] = useState<Map<string, string>>(new Map());

    // Store excluded configs per package
    const [excludedConfigs, setExcludedConfigs] = useState<Map<string, ExcludedConfig>>(new Map());


    // Add this state in your component
    const [bytecodeTemplates, setBytecodeTemplates] = useState<BytecodeTemplate[]>([
        {
            name: "Turret Owner Only",
            description: " Only the turret owner will be not attacked by turret. ",
            filename: "turret_owner_only.mv",
            bytecode: null,
        },
        {
            name: "Turret Owner + Starting Corp",
            description: " Owner and starting corporation members are ignored by turret. ",
            filename: "turret_owner_and_starting_corp.mv",
            bytecode: null,
        }
    ]);
    const [selectedTemplate, setSelectedTemplate] = useState<string>("turret_owner_only.mv");
    const [deployType, setDeployType] = useState<"default" | "custom">("default");

    // Get the connected wallet instance
    const getConnectedWallet = () => {
        if (!account || !wallets.length) return null;
        return wallets.find(wallet =>
            wallet.accounts.some(acc => acc.address === account.address)
        );
    };

    // Sign and execute using wallet standard features
    const signAndExecuteWithWallet = async (txb: Transaction) => {
        const wallet = getConnectedWallet();
        if (!wallet) throw new Error("Connected wallet not found");

        const feature = wallet.features['sui:signAndExecuteTransaction'];
        if (!feature) throw new Error("Wallet does not support signAndExecuteTransaction");

        const walletAccount = wallet.accounts.find(acc => acc.address === account?.address);
        if (!walletAccount) throw new Error("Account not found in wallet");

        const result = await feature.signAndExecuteTransaction({
            transaction: txb,
            account: walletAccount,
            chain: 'sui:testnet',
            options: {
                showEffects: true,
                showEvents: true,
                showObjectChanges: true,
            }
        });

        return result;
    };

    // Query for deployed extension packages via upgrade caps
    const { data: deployedPackages, isLoading: loadingPackages, refetch: refetchPackages } = useQuery({
        queryKey: ['deployedPackages', account?.address],
        queryFn: async () => {
            if (!account || !suiClient) return [];

            const upgradeCaps = await suiClient.getOwnedObjects({
                owner: account.address,
                filter: { StructType: "0x2::package::UpgradeCap" },
                options: { showContent: true, showType: true },
            });

            const packages: DeployedPackage[] = [];

            for (const cap of upgradeCaps.data) {
                if (!cap.data?.content) continue;

                const content = cap.data.content as any;
                const pkgId = content.fields.package;
                const version = content.fields.version;

                if (pkgId) {
                    try {
                        const packageObj = await suiClient.getObject({
                            id: pkgId,
                            options: { showContent: true }
                        });

                        if (packageObj.data) {
                            packages.push({
                                packageId: pkgId,
                                capId: cap.data.objectId,
                                version: version,
                            });
                        }
                    } catch (err) {
                        console.log("Package not found, skipping");
                    }
                }
            }

            return packages;
        },
        enabled: !!account && !!suiClient,
    });

    // Auto-select if only one package found
    useEffect(() => {
        if (deployedPackages && deployedPackages.length > 0) {
            if (deployedPackages.length === 1 && !packageId) {
                setPackageId(deployedPackages[0].packageId);
            }
        }
    }, [deployedPackages, packageId]);

    // Fetch bytecode and dump
    useEffect(() => {
        const fetchBytecode = async () => {
            try {
                const bytecodeResponse = await fetch('/bytecode/turret.mv');
                if (!bytecodeResponse.ok) throw new Error('Bytecode not found');
                const buffer = await bytecodeResponse.arrayBuffer();
                setBytecode(Array.from(new Uint8Array(buffer)));

                const dumpResponse = await fetch('/bytecode/bytecode_dump.json');
                if (dumpResponse.ok) {
                    const dump = await dumpResponse.json();
                    setBytecodeDump(dump);
                }
            } catch (err) {
                console.error("Error loading bytecode:", err);
            }
        };
        fetchBytecode();
    }, []);


    // Add useEffect to load default bytecodes
    useEffect(() => {
        const loadDefaultBytecodes = async () => {
            const updatedTemplates = [...bytecodeTemplates];

            for (let i = 0; i < updatedTemplates.length; i++) {
                try {
                    const response = await fetch(`/bytecode/${updatedTemplates[i].filename}`);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        updatedTemplates[i].bytecode = Array.from(new Uint8Array(buffer));


                    }
                } catch (err) {
                    console.error(`Error loading ${updatedTemplates[i].filename}:`, err);
                }
            }

            setBytecodeTemplates(updatedTemplates);
        };

        loadDefaultBytecodes();
    }, []);

    // Update the useEffect
    useEffect(() => {
        const loadDefaultBytecodes = async () => {
            setTemplatesLoading(true);
            const updatedTemplates = [...bytecodeTemplates];

            for (let i = 0; i < updatedTemplates.length; i++) {
                try {
                    const response = await fetch(`/bytecode/${updatedTemplates[i].filename}`);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        updatedTemplates[i].bytecode = Array.from(new Uint8Array(buffer));

                        // Try to load corresponding digest
                        try {
                            const dumpResponse = await fetch(`/bytecode/${updatedTemplates[i].filename.replace('.mv', '_dump.json')}`);
                            if (dumpResponse.ok) {
                                const dump = await dumpResponse.json();
                                updatedTemplates[i].digest = dump.digest;
                            }
                        } catch (e) {
                            console.log(`No digest found for ${updatedTemplates[i].filename}`);
                        }
                    }
                } catch (err) {
                    console.error(`Error loading ${updatedTemplates[i].filename}:`, err);
                }
            }

            setBytecodeTemplates(updatedTemplates);
            setTemplatesLoading(false);
        };

        loadDefaultBytecodes();
    }, []);

    const { data: profileData, isLoading: profileLoading, error: profileError } = useQuery({
        queryKey: ['playerProfile', account?.address],
        queryFn: async () => {
            if (!account || !suiClient) return null;

            try {
                const profileObjects = await suiClient.getOwnedObjects({
                    owner: account.address,
                    filter: { StructType: PLAYER_PROFILE_TYPE },
                    options: { showContent: true, showType: true },
                });

                if (profileObjects.data.length === 0) return null;

                const profileId = profileObjects.data[0].data!.objectId;

                const profileObj = await suiClient.getObject({
                    id: profileId,
                    options: { showContent: true, showType: true },
                });

                if (!profileObj.data?.content) return null;

                const content = profileObj.data.content as any;

                if (!content.fields.character_id) {
                    return {
                        id: profileId,
                        characterId: null,
                        char_item_id: null,
                        tribe_id: null,
                    };
                }

                const characterObj = await suiClient.getObject({
                    id: content.fields.character_id,
                    options: { showContent: true, showType: true },
                });

                const charItemId = characterObj?.data?.content?.fields?.key?.fields?.item_id;
                const tribeId = characterObj?.data?.content?.fields?.tribe_id;

                return {
                    id: profileId,
                    characterId: content.fields.character_id,
                    char_item_id: charItemId || null,
                    tribe_id: tribeId || null,
                };
            } catch (error) {
                console.error("Error fetching player profile:", error);
                throw error;
            }
        },
        enabled: !!account && !!suiClient,
        retry: 1,
        staleTime: 30000,
    });

    // Update player profile when data loads
    useEffect(() => {
        if (profileData) {
            setPlayerProfile(profileData);
            setCharacterAccount(profileData.characterId);
            setCharacterID(profileData.char_item_id);
            setCharacterTribeID(profileData.tribe_id);
        }
    }, [profileData]);

    // Query for OwnerCaps owned by character
    const { data: capsData, isLoading: capsLoading, refetch: refetchCaps } = useQuery({
        queryKey: ['ownerCaps', characterAccount],
        queryFn: async () => {
            if (!characterAccount || !suiClient) return [];

            const ownedObjects = await suiClient.getOwnedObjects({
                owner: characterAccount,
                options: { showContent: true, showType: true },
            });

            const caps: OwnerCap[] = [];
            const turretIds: string[] = [];

            for (const obj of ownedObjects.data) {
                if (!obj.data) continue;

                if (obj.data.type === OWNER_CAP_TYPE && obj.data.content) {
                    const content = obj.data.content as any;
                    const assemblyId = content.fields.authorized_object_id;
                    caps.push({
                        id: obj.data.objectId,
                        assemblyId,
                    });
                    turretIds.push(assemblyId);
                }
            }

            // Fetch turret objects
            if (turretIds.length > 0) {
                const turretObjects = await suiClient.multiGetObjects({
                    ids: turretIds,
                    options: { showContent: true, showType: true },
                });

                const turretMap = new Map();
                for (const obj of turretObjects) {
                    if (!obj.data?.content) continue;
                    const content = obj.data.content as any;
                    let extension = null;
                    if (content.fields.extension && content.fields.extension.fields) {
                        extension = content.fields.extension.fields.name;
                    }
                    turretMap.set(obj.data.objectId, {
                        id: obj.data.objectId,
                        extension,
                    });
                }
                setTurrets(turretMap);
            }

            return caps;
        },
        enabled: !!characterAccount && !!suiClient,
    });

    // Update owner caps when data loads
    useEffect(() => {
        if (capsData) {
            setOwnerCaps(capsData);
        }
    }, [capsData]);

    // Function to get the original (version 1) package address
    const getOriginalPackageAddress = async (currentPackageId: string): Promise<string | null> => {
        try {
            const response = await fetch(GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: GET_ORIGINAL_PACKAGE,
                    variables: { packageId: currentPackageId }
                })
            });

            const result = await response.json();

            if (result.data?.package) {
                const packageInfo = result.data.package;
                if (packageInfo.version === 1) return currentPackageId;

                const versions = packageInfo.packageVersionsBefore?.nodes || [];
                if (versions.length > 0) {
                    return versions[versions.length - 1].address;
                }
            }
            return currentPackageId;
        } catch (err) {
            console.error("Error fetching original package:", err);
            return currentPackageId;
        }
    };

    // Function to fetch excluded config for a specific package
    const fetchExcludedConfigForPackage = async (packageId: string): Promise<ExcludedConfig | null> => {
        try {
            const originalPackageId = await getOriginalPackageAddress(packageId);
            const ObjType_ExcludedConfig = `${originalPackageId}::turret::ExcludedConfig`;

            const response = await fetch(GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: GET_OBJ_BY_TYPE,
                    variables: { type: ObjType_ExcludedConfig }
                })
            });

            const dataFull = await response.json();
            const data = dataFull.data;

            if (data.objects.nodes && data.objects.nodes.length > 0) {
                const configObj = data.objects.nodes[0];
                const configId = configObj.address;

                const result = await suiClient.getObject({
                    id: configId,
                    options: { showContent: true }
                });

                if (result.data?.content && 'fields' in result.data.content) {
                    const fields = result.data.content.fields as any;
                    return {
                        characterIds: fields.character_ids || [],
                        tribeIds: fields.tribe_ids || []
                    };
                }
            }
            return null;
        } catch (err) {
            console.error(`Error fetching excluded config for package ${packageId}:`, err);
            return null;
        }
    };

    // Function to fetch version info for a package and all its previous versions
    const fetchPackageVersionHistory = async (packageId: string): Promise<Map<string, number>> => {
        try {
            const response = await fetch(GRAPHQL_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: GET_HISTORY_OF_PACKAGE,
                    variables: { packageId: packageId }
                })
            });

            const result = await response.json();
            const versionMap = new Map<string, number>();

            if (result.data?.package) {
                const currentPackage = result.data.package;
                versionMap.set(currentPackage.address, currentPackage.version);

                const previousVersions = currentPackage.packageVersionsBefore?.nodes || [];
                for (const pkg of previousVersions) {
                    versionMap.set(pkg.address, pkg.version);
                }
            }
            return versionMap;
        } catch (err) {
            console.error("Error fetching package history:", err);
            return new Map();
        }
    };

    // Effect to load all version history from deployedPackages
    useEffect(() => {
        const loadAllVersions = async () => {
            if (!deployedPackages || deployedPackages.length === 0) return;

            const newVersionMap = new Map<string, number>();
            const newChainMap = new Map<string, string>();

            for (const pkg of deployedPackages) {
                if (newVersionMap.has(pkg.packageId)) continue;

                const history = await fetchPackageVersionHistory(pkg.packageId);

                for (const [id, version] of history.entries()) {
                    newVersionMap.set(id, version);
                    if (version === 1) {
                        newChainMap.set(id, id);
                    } else {
                        let originalId = id;
                        for (const [historyId, historyVersion] of history.entries()) {
                            if (historyVersion === 1) {
                                originalId = historyId;
                                break;
                            }
                        }
                        newChainMap.set(id, originalId);
                    }
                }
            }

            setPackageVersionMap(newVersionMap);
            setPackageChainMap(newChainMap);
        };

        loadAllVersions();
    }, [deployedPackages]);

    // Effect to load excluded configs for all authorized packages
    useEffect(() => {
        const loadExcludedConfigs = async () => {
            const uniquePackageIds = new Set<string>();

            // Collect unique package IDs from turret authorizations
            for (const packageId of turretAuths.values()) {
                uniquePackageIds.add(packageId);
            }

            // Also include the selected package if it's not already included
            if (packageId) {
                uniquePackageIds.add(packageId);
            }

            const newExcludedConfigs = new Map<string, ExcludedConfig>();

            for (const pkgId of uniquePackageIds) {
                if (!excludedConfigs.has(pkgId)) {
                    const config = await fetchExcludedConfigForPackage(pkgId);
                    if (config) {
                        newExcludedConfigs.set(pkgId, config);
                    }
                }
            }

            if (newExcludedConfigs.size > 0) {
                setExcludedConfigs(prev => new Map([...prev, ...newExcludedConfigs]));
            }
        };

        if ((turretAuths.size > 0 || packageId) && suiClient) {
            loadExcludedConfigs();
        }
    }, [turretAuths, packageId, suiClient]);

    // Query to find the ExcludedConfig object (run once after deployment)
    useEffect(() => {
        const findExcludedConfig = async () => {
            if (!packageId || !suiClient) return;

            try {
                const originalPackageId = await getOriginalPackageAddress(packageId);
                const ObjType_ExcludedConfig = `${originalPackageId}::turret::ExcludedConfig`;

                const response = await fetch(GRAPHQL_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: GET_OBJ_BY_TYPE,
                        variables: { type: ObjType_ExcludedConfig }
                    })
                });

                const dataFull = await response.json();
                const data = dataFull.data;

                if (data.objects.nodes && data.objects.nodes.length > 0) {
                    const configObj = data.objects.nodes[0];
                    setExcludedConfigId(configObj.address);
                } else {
                    setExcludedConfigId(null);
                }

                const ObjType_ExclConfAdminCap = `${originalPackageId}::turret::AdminCap`;
                const response_admin_cup = await fetch(GRAPHQL_ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: GET_OBJ_BY_TYPE,
                        variables: { type: ObjType_ExclConfAdminCap }
                    })
                });
                const dataFull_adminCup = await response_admin_cup.json();
                const data_adminCup = dataFull_adminCup.data;

                if (data_adminCup.objects.nodes && data_adminCup.objects.nodes.length > 0) {
                    setAdminCapId(data_adminCup.objects.nodes[0].address);
                } else {
                    setAdminCapId(null);
                }
            } catch (err) {
                console.error("Error:", err);
            }
        };

        findExcludedConfig();
    }, [account, suiClient, packageId]);

    // Query for excluded character IDs from the shared object
    const { data: excludedConfig, refetch: refetchExcludedConfig } = useQuery({
        queryKey: ['excludedConfig', excludedConfigId],
        queryFn: async () => {
            if (!excludedConfigId || !suiClient) return null;

            try {
                const result = await suiClient.getObject({
                    id: excludedConfigId,
                    options: { showContent: true }
                });

                if (result.data?.content && 'fields' in result.data.content) {
                    const fields = result.data.content.fields as any;
                    return {
                        characterIds: fields.character_ids || [],
                        tribeIds: fields.tribe_ids || []
                    };
                }
                return null;
            } catch (err) {
                console.error("Error fetching excluded config:", err);
                return null;
            }
        },
        enabled: !!excludedConfigId && !!suiClient,
    });

    // Set the data when loaded
    useEffect(() => {
        if (excludedConfig) {
            setExcludedCharacterIds(excludedConfig.characterIds);
            setExcludedTribes(excludedConfig.tribeIds);
        }
    }, [excludedConfig]);

    

    // Deploy extension with specific bytecode (for templates)
    const deployExtensionWithBytecode = async (bytecodeToDeploy: number[], digestToDeploy?: number[]) => {
        if (!account) {
            alert("Please connect your wallet first");
            return;
        }

        if (!bytecodeToDeploy) {
            alert("Bytecode not available");
            return;
        }

        setDeploying(true);
        setDeployError(null);

        try {
            console.log("Deploying with bytecode:", bytecodeToDeploy.length, "bytes");
            console.log("Using digest:", digestToDeploy);

            const txb = new Transaction();
            const upgradeCap = txb.publish({
                modules: [bytecodeToDeploy],
                dependencies: ["0x1", "0x2", WORLD_PACKAGE],
            });

            txb.transferObjects([upgradeCap], txb.pure.address(account.address));

            const result = await signAndExecuteWithWallet(txb);
            console.log("Deployment result:", result);

            refetchPackages();

            // Show which template was deployed
            if (deployType === "default") {
                const templateName = bytecodeTemplates.find(t => t.bytecode === bytecodeToDeploy)?.name;
                alert(`Extension deployed successfully using template: ${templateName || 'Default Template'}!`);
            } else {
                alert("Extension deployed successfully!");
            }

        } catch (err: any) {
            console.error("Deployment error details:", err);
            setDeployError(err.message || "Failed to deploy extension");
        } finally {
            setDeploying(false);
        }
    };

    // Keep original deployExtension for custom bytecode
    const deployExtension = async () => {
        if (!bytecode) {
            alert("Bytecode not loaded yet");
            return;
        }
        await deployExtensionWithBytecode(bytecode, bytecodeDump?.digest);
    };

    // Upgrade extension - USING DIGEST FROM DUMP.JSON
    const upgradeExtension = async (pkg: DeployedPackage) => {
        if (!account) {
            alert("Please connect your wallet first");
            return;
        }

        if (!bytecode || !bytecodeDump) {
            alert("Bytecode or dump not loaded yet");
            return;
        }

        setUpgrading(true);
        setDeployError(null);

        try {
            const digestArray = bytecodeDump.digest;
            if (!digestArray) throw new Error("No digest found in dump.json");

            const digest = new Uint8Array(digestArray);
            const serializedDigest = bcs.vector(bcs.u8()).serialize(digest).toBytes();

            const txb = new Transaction();
            const upgradeCap = txb.object(pkg.capId);

            const [ticket] = txb.moveCall({
                target: '0x2::package::authorize_upgrade',
                arguments: [upgradeCap, txb.pure.u8(0), txb.pure(serializedDigest)],
                typeArguments: [],
            });

            const [receipt] = txb.upgrade({
                modules: [bytecode],
                dependencies: ["0x1", "0x2", WORLD_PACKAGE],
                package: pkg.packageId,
                ticket: ticket,
            });

            txb.moveCall({
                target: '0x2::package::commit_upgrade',
                arguments: [upgradeCap, receipt],
                typeArguments: [],
            });

            await signAndExecuteWithWallet(txb);
            alert("Extension upgraded successfully!");
            setPackageId(null);
            refetchPackages();
        } catch (err: any) {
            console.error("Upgrade error details:", err);
            setDeployError(err.message || "Failed to upgrade extension");
        } finally {
            setUpgrading(false);
        }
    };

    // Authorize extension on turret 
    const authorizeExtension = async () => {
        if (!packageId || !selectedTurret || !characterAccount) {
            alert("Missing package, turret, or character account");
            return;
        }

        const ownerCap = ownerCaps.find(cap => cap.assemblyId === selectedTurret);
        if (!ownerCap) {
            alert("No OwnerCap found for this turret!");
            return;
        }

        const turret = turrets.get(selectedTurret);
        if (turret?.extension === packageId) {
            alert("This turret is already authorized with this extension!");
            return;
        }

        setAuthorizing(true);

        try {
            const txb = new Transaction();
            const characterId = characterAccount;

            const [borrowedOwnerCap, receipt] = txb.moveCall({
                target: `${WORLD_PACKAGE}::character::borrow_owner_cap`,
                typeArguments: [`${WORLD_PACKAGE}::turret::Turret`],
                arguments: [txb.object(characterId), txb.object(ownerCap.id)],
            });

            txb.moveCall({
                target: `${WORLD_PACKAGE}::turret::authorize_extension`,
                arguments: [txb.object(selectedTurret), borrowedOwnerCap],
                typeArguments: [`${packageId}::turret::TurretAuth`],
            });

            txb.moveCall({
                target: `${WORLD_PACKAGE}::character::return_owner_cap`,
                typeArguments: [`${WORLD_PACKAGE}::turret::Turret`],
                arguments: [txb.object(characterId), borrowedOwnerCap, receipt],
            });

            const result = await signAndExecuteWithWallet(txb);
            alert("Extension authorized successfully!");
            console.log("Authorization result:", result);

            await refetchCaps();
            if (account?.address) {
                const auths = await getAllAuthorizations(account.address);
                const packageMap = new Map();
                auths.forEach((value, key) => {
                    packageMap.set(key, value.packageId);
                });
                setTurretAuths(packageMap);
            }
            setSelectedTurret(null);
        } catch (err: any) {
            console.error("Authorization error:", err);
            alert("Failed to authorize: " + err.message);
        } finally {
            setAuthorizing(false);
        }
    };

    // Fetch all authorization transactions for the character
    useEffect(() => {
        const fetchAuths = async () => {
            if (!account?.address) return;
            const auths = await getAllAuthorizations(account.address);
            const packageMap = new Map();
            auths.forEach((value, key) => {
                packageMap.set(key, value.packageId);
            });
            setTurretAuths(packageMap);
        };
        fetchAuths();
    }, [account, suiClient]);

    async function getAllAuthorizations(characterAddress: string) {
        const query = `
    query {
      transactions(
        filter: {
          sentAddress: "${characterAddress}"
          function: "${WORLD_PACKAGE}::turret::authorize_extension"
        }
        last: 50
      ) {
        nodes {
          digest
          effects {
            timestamp
          }
          transactionJson
        }
      }
    }
    `;

        try {
            const response = await fetch('https://graphql.testnet.sui.io/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });

            const data = await response.json();
            const authorizations = new Map<string, { packageId: string, timestamp: string }>();

            if (!data.data?.transactions?.nodes) return authorizations;

            data.data.transactions.nodes.forEach((tx: any) => {
                try {
                    const transactionJson = tx.transactionJson;
                    if (!transactionJson || !transactionJson.kind?.programmableTransaction) return;

                    const inputs = transactionJson.kind.programmableTransaction.inputs;
                    const commands = transactionJson.kind.programmableTransaction.commands;

                    const authorizeCommand = commands.find((cmd: any) =>
                        cmd.moveCall?.function === 'authorize_extension'
                    );

                    if (!authorizeCommand || !authorizeCommand.moveCall.typeArguments) return;

                    const turretArgument = authorizeCommand.moveCall.arguments.find((arg: any) =>
                        arg.kind === 'INPUT'
                    );

                    if (turretArgument) {
                        const inputIndex = turretArgument.input;
                        const turretInput = inputs[inputIndex];

                        if (turretInput && turretInput.objectId) {
                            const turretId = turretInput.objectId;
                            const extensionType = authorizeCommand.moveCall.typeArguments[0];
                            const extensionPackageId = extensionType.split('::')[0];

                            authorizations.set(turretId, {
                                packageId: extensionPackageId,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                } catch (err) {
                    console.error("Error processing transaction:", err);
                }
            });

            return authorizations;
        } catch (err) {
            console.error("Error fetching authorizations:", err);
            return new Map();
        }
    }

    // Function to sync config with constants (admin only)
    const syncConfigFromConstants = async () => {
        if (!packageId || !adminCapId || !excludedConfigId) {
            alert("Missing package, admin cap, or config object");
            return;
        }

        setLoadingExcluded(true);

        try {
            const txb = new Transaction();
            const adminCap = txb.object(adminCapId);
            const config = txb.object(excludedConfigId);

            txb.setSender(account!.address);

            txb.moveCall({
                target: `${packageId}::turret::sync_config_from_constants`,
                arguments: [adminCap, config],
            });

            await signAndExecuteWithWallet(txb);
            refetchExcludedConfig();
            alert("Config synced successfully!");
        } catch (err: any) {
            console.error("Error syncing config:", err);
            alert("Failed to sync: " + err.message);
        } finally {
            setLoadingExcluded(false);
        }
    };

    // Get version for any package ID
    const getPackageVersion = (packageId: string): number | null => {
        return packageVersionMap.get(packageId) || null;
    };

    // Get the original package ID (version 1) for any package
    const getOriginalPackageId = (packageId: string): string | null => {
        return packageChainMap.get(packageId) || null;
    };

    // Get the latest version for a specific package family
    const getLatestVersionForPackage = (packageId: string): DeployedPackage | null => {
        if (!deployedPackages || deployedPackages.length === 0) return null;

        const originalId = getOriginalPackageId(packageId);
        if (!originalId) return null;

        const familyPackages = deployedPackages.filter(pkg => {
            const pkgOriginal = getOriginalPackageId(pkg.packageId);
            return pkgOriginal === originalId;
        });

        if (familyPackages.length === 0) return null;

        const sorted = [...familyPackages].sort((a, b) => {
            const aVersion = a.version || 0;
            const bVersion = b.version || 0;
            return bVersion - aVersion;
        });

        return sorted[0];
    };

    // Helper function to extract package ID from full type string
    const extractPackageId = (fullTypeString: string): string => {
        if (!fullTypeString) return '';
        // Split and get the first part
        const packageId = fullTypeString.split('::')[0];
        // Ensure it has the 0x prefix (it should already, but just in case)
        return packageId.startsWith('0x') ? packageId : `0x${packageId}`;
    };

    const isLoading = profileLoading || capsLoading || loadingPackages;

    return (
        <Container my="4">
            <Card mb="4">
                <Flex direction="column" gap="3" p="4">
                    <Text size="5" weight="bold">Turret Behaviour Extension</Text>

                    {account && (
                        <Box style={{ borderTop: '1px solid var(--gray-4)' }} pt="2">
                            <Flex align="center" gap="2" wrap="wrap">
                                <Flex align="center" gap="1" px="2" py="1">
                                    <Text size="2" weight="medium">Wallet:</Text>
                                    <CopyableCode address={account.address} precision={6} size="2" />
                                </Flex>
                            </Flex>
                        </Box>
                    )}

                    {characterAccount ? (
                        <Box>
                            <Flex direction="column" gap="2">
                                <Text size="2" weight="medium">Character Details</Text>
                                <Flex align="center" gap="3" wrap="wrap">
                                    <Flex align="center" gap="2" px="2" py="1">
                                        <Text size="2">Address:</Text>
                                        <CopyableCode address={characterAccount} precision={6} size="2" />
                                    </Flex>
                                    <Flex align="center" gap="2" px="2" py="1">
                                        <Text size="2">Char ID:</Text>
                                        <Text size="2" weight="medium">{characterID || ''}</Text>
                                    </Flex>
                                    <Flex align="center" gap="2" px="2" py="1">
                                        <Text size="2">Tribe ID:</Text>
                                        <Text size="2" weight="medium">{characterTribeID || ''}</Text>
                                    </Flex>
                                </Flex>
                            </Flex>
                        </Box>
                    ) : (
                        account && (
                            <Box p="2">
                                <Flex align="center" gap="2">
                                    <Text size="2" color="yellow">�</Text>
                                    <Text size="2" color="yellow">No character associated with this wallet</Text>
                                </Flex>
                            </Box>
                        )
                    )}
                </Flex>
            </Card>

            <Tabs.Root defaultValue="authorize">
                <Tabs.List>
                    <Tabs.Trigger value="authorize">Turrets</Tabs.Trigger>
                    <Tabs.Trigger value="packages">Packages</Tabs.Trigger>
                    <Tabs.Trigger value="excluded">Excluded Characters</Tabs.Trigger>
                    <Tabs.Trigger value="deploy">Deploy New</Tabs.Trigger>
                </Tabs.List>

                <Box pt="4">
                    {/* Authorize Tab - Shows turrets with excluded info */}
                    <Tabs.Content value="authorize">
                        <Card>
                            <Flex direction="column" gap="4" p="4">
                                <Flex justify="between" align="center" wrap="wrap" gap="3">
                                    <Text weight="bold">Authorize Extension on Turrets</Text>

                                    {/* Package Selection Dropdown */}
                                    {deployedPackages && deployedPackages.length > 0 ? (
                                        <Select.Root
                                            value={packageId || ""}
                                            onValueChange={(value) => setPackageId(value || null)}
                                        >
                                            <Select.Trigger placeholder="Select a package" style={{ minWidth: '250px' }}>
                                                {packageId ? (
                                                    <Flex align="center" gap="2">
                                                        <Text size="1">{packageId.slice(0, 8)}...{packageId.slice(-6)}</Text>
                                                        {(() => {
                                                            const pkg = deployedPackages.find(p => p.packageId === packageId);
                                                            return pkg?.version && <Badge size="1">v{pkg.version}</Badge>;
                                                        })()}
                                                    </Flex>
                                                ) : (
                                                    "Select a package"
                                                )}
                                            </Select.Trigger>
                                            <Select.Content>
                                                <Select.Group>
                                                    <Select.Label>Available Packages</Select.Label>
                                                    {deployedPackages.map((pkg) => (
                                                        <Select.Item key={pkg.packageId} value={pkg.packageId}>
                                                            <Flex align="center" gap="2" justify="between" style={{ width: '100%' }}>
                                                                <Text size="1">{pkg.packageId.slice(0, 8)}...{pkg.packageId.slice(-6)}</Text>
                                                                {pkg.version && (
                                                                    <Badge size="1" color="blue">v{pkg.version}</Badge>
                                                                )}
                                                            </Flex>
                                                        </Select.Item>
                                                    ))}
                                                </Select.Group>
                                            </Select.Content>
                                        </Select.Root>
                                    ) : (
                                        <Button size="1" variant="outline" onClick={() => document.querySelector('[data-radix-tab="deploy"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))}>
                                            No packages - Deploy First
                                        </Button>
                                    )}
                                </Flex>

                                {isLoading ? (
                                    <Flex justify="center" p="4">
                                        <Spinner />
                                    </Flex>
                                ) : ownerCaps.length === 0 ? (
                                    <Text color="gray">No turrets found for your character</Text>
                                ) : (
                                    <Flex direction="column" gap="2">
                                        {/* Turrets list */}
                                        <Flex direction="column" gap="3">
                                            {ownerCaps
                                                .filter(cap => turrets.has(cap.assemblyId))
                                                .map((cap) => {
                                                    const turret = turrets.get(cap.assemblyId);
                                                    const isAuthorized = packageId ? turret?.extension === packageId : false;
                                                    const actualAuthorizedPackageId = turretAuths.get(cap.assemblyId);
                                                    const currentVersion = getPackageVersion(actualAuthorizedPackageId);
                                                    const latestPackage = getLatestVersionForPackage(actualAuthorizedPackageId);
                                                    const needsUpdate = actualAuthorizedPackageId && latestPackage &&
                                                        actualAuthorizedPackageId !== latestPackage.packageId;

                                                    // Get excluded config for the authorized package
                                                    const authorizedPackageId = turret?.extension || actualAuthorizedPackageId;
                                                    const excludedConfigForTurret = authorizedPackageId ? excludedConfigs.get(authorizedPackageId) : null;


                                                    return (
                                                        <Card key={cap.id} variant={selectedTurret === cap.assemblyId ? "classic" : "surface"}>
                                                            <Flex direction="column" gap="2" p="3">
                                                                {/* Main row with turret info and buttons */}
                                                                <Flex justify="between" align="center" wrap="wrap" gap="2">
                                                                    <Box>
                                                                        <Text size="2" weight="bold">Turret:</Text>
                                                                        <CopyableCode address={cap.assemblyId} precision={8} size="1" />
                                                                    </Box>
                                                                    <Flex gap="2">
                                                                        <Button
                                                                            size="1"
                                                                            variant={selectedTurret === cap.assemblyId ? "solid" : "outline"}
                                                                            onClick={() => setSelectedTurret(cap.assemblyId)}
                                                                            disabled={!packageId}
                                                                        >
                                                                            Select Turret
                                                                        </Button>
                                                                        {selectedTurret === cap.assemblyId && (
                                                                            <Button
                                                                                size="1"
                                                                                onClick={authorizeExtension}
                                                                                disabled={authorizing || !packageId || isAuthorized}
                                                                            >
                                                                                {authorizing ? <Spinner /> : isAuthorized ? "Authorized" : "Authorize"}
                                                                            </Button>
                                                                        )}
                                                                    </Flex>
                                                                </Flex>

                                                                {/* OwnerCap info */}
                                                                <Text size="1" color="gray">
                                                                    OwnerCap: <CopyableCode address={cap.id} precision={6} size="1" />
                                                                </Text>

                                                                {/* Extension status row */}
                                                                <Box>
                                                                    <Flex align="center" gap="2" wrap="wrap">
                                                                        <Text size="1" color="gray">Extension:</Text>

                                                                        {actualAuthorizedPackageId ? (
                                                                            <Flex align="center" gap="2" wrap="wrap">
                                                                                <CopyableCode
                                                                                    address={actualAuthorizedPackageId}
                                                                                    precision={8}
                                                                                    size="1"
                                                                                />
                                                                                {currentVersion && (
                                                                                    <Badge size="1" color={isAuthorized ? "green" : "blue"}>
                                                                                        v{currentVersion}
                                                                                    </Badge>
                                                                                )}
                                                                                {needsUpdate && (
                                                                                    <Badge size="1" color="orange" variant="surface">
                                                                                        ⬆ Update: v{currentVersion || '?'} → v{latestPackage?.version || '?'}
                                                                                    </Badge>
                                                                                )}
                                                                                {packageId && isAuthorized && (
                                                                                    <Text size="1" color="green" weight="bold">✓ Current</Text>
                                                                                )}
                                                                            </Flex>
                                                                        ) : (
                                                                            <Flex align="center" gap="2">
                                                                                <Text size="1" color="gray">No extension authorized</Text>
                                                                                {packageId && selectedTurret === cap.assemblyId && (
                                                                                    <Button size="1" variant="soft" onClick={authorizeExtension} disabled={authorizing}>
                                                                                        {authorizing ? <Spinner size="1" /> : "Authorize Now"}
                                                                                    </Button>
                                                                                )}
                                                                            </Flex>
                                                                        )}
                                                                    </Flex>
                                                                </Box>

                                                                {/* Show excluded characters and tribes for this turret's extension */}
                                                                {(() => {
                                                                    // Get the authorized package ID (either from turret extension or from stored auths)
                                                                    const authorizedFullType = turret?.extension || actualAuthorizedPackageId;
                                                                    // Extract just the package ID (remove ::module::type)
                                                                    const packageIdOnly = authorizedFullType ? extractPackageId(authorizedFullType) : null;
                                                                    // Look up the excluded config using the clean package ID
                                                                    const excludedConfigForTurret = packageIdOnly ? excludedConfigs.get(packageIdOnly) : null;


                                                                    if (!excludedConfigForTurret) return null;

                                                                    return (
                                                                        <Box mt="2" p="2" style={{ backgroundColor: 'var(--gray-3)', borderRadius: '6px' }}>
                                                                            <Text size="1" weight="bold" mb="1"> Attack all except:</Text>
                                                                            <Flex direction="column" gap="1">
                                                                                {excludedConfigForTurret.characterIds.length > 0 && (
                                                                                    <Flex align="center" gap="2" wrap="wrap">
                                                                                        <Text size="1" color="gray">Owner and Character IDs:</Text>
                                                                                        <Flex gap="1" wrap="wrap">
                                                                                            {excludedConfigForTurret.characterIds.slice(0, 5).map((id) => (
                                                                                                <Badge key={id} size="1" color="red" variant="surface">
                                                                                                    {id}
                                                                                                </Badge>
                                                                                            ))}
                                                                                            {excludedConfigForTurret.characterIds.length > 5 && (
                                                                                                <Text size="1" color="gray">+{excludedConfigForTurret.characterIds.length - 5} more</Text>
                                                                                            )}
                                                                                        </Flex>
                                                                                    </Flex>
                                                                                )}
                                                                                {excludedConfigForTurret.tribeIds.length > 0 && (
                                                                                    <Flex align="center" gap="2" wrap="wrap">
                                                                                        <Text size="1" color="gray">Tribe IDs:</Text>
                                                                                        <Flex gap="1" wrap="wrap">
                                                                                            {excludedConfigForTurret.tribeIds.slice(0, 5).map((id) => (
                                                                                                <Badge key={id} size="1" color="red" variant="surface">
                                                                                                    {id}
                                                                                                </Badge>
                                                                                            ))}
                                                                                            {excludedConfigForTurret.tribeIds.length > 5 && (
                                                                                                <Text size="1" color="gray">+{excludedConfigForTurret.tribeIds.length - 5} more</Text>
                                                                                            )}
                                                                                        </Flex>
                                                                                    </Flex>
                                                                                )}
                                                                                {excludedConfigForTurret.characterIds.length === 0 && excludedConfigForTurret.tribeIds.length === 0 && (
                                                                                    <Text size="1" color="gray">Owner</Text>
                                                                                )}
                                                                            </Flex>
                                                                        </Box>
                                                                    );
                                                                })()}
                                                            </Flex>
                                                        </Card>
                                                    );
                                                })}

                                            {/* Show count of filtered vs total */}
                                            {ownerCaps.filter(cap => turrets.has(cap.assemblyId)).length !== ownerCaps.length && (
                                                <Text size="1" color="gray" mt="2">
                                                    Showing {ownerCaps.filter(cap => turrets.has(cap.assemblyId)).length} of {ownerCaps.length} turrets
                                                    ({ownerCaps.length - ownerCaps.filter(cap => turrets.has(cap.assemblyId)).length} deleted/removed turrets hidden)
                                                </Text>
                                            )}
                                        </Flex>
                                    </Flex>
                                )}
                            </Flex>
                        </Card>
                    </Tabs.Content>

                    {/* Packages Tab - Always visible */}
                    <Tabs.Content value="packages">
                        <Card>
                            <Flex direction="column" gap="4" p="4">
                                <Text weight="bold">Your Deployed Extension Packages</Text>

                                {loadingPackages ? (
                                    <Flex justify="center" p="4">
                                        <Spinner />
                                        <Text ml="2">Scanning for deployed packages...</Text>
                                    </Flex>
                                ) : deployedPackages && deployedPackages.length > 0 ? (
                                    <Flex direction="column" gap="3">
                                        {deployedPackages.map((pkg, idx) => (
                                            <Card key={pkg.packageId} variant={packageId === pkg.packageId ? "classic" : "surface"}>
                                                <Flex direction="column" gap="2" p="3">
                                                    <Box>
                                                        <Text size="2" weight="bold">Package {idx + 1}:</Text>
                                                        <Code size="1" style={{ wordBreak: 'break-all' }}>
                                                            {pkg.packageId}
                                                        </Code>
                                                    </Box>
                                                    {pkg.version && (
                                                        <Text size="2">Version: {pkg.version}</Text>
                                                    )}
                                                    <Box>
                                                        <Text size="2" weight="bold">Upgrade Cap:</Text>
                                                        <Code size="1" style={{ wordBreak: 'break-all' }}>
                                                            {pkg.capId}
                                                        </Code>
                                                    </Box>
                                                    <Flex gap="2" justify="end" mt="2">
                                                        <Button
                                                            size="1"
                                                            variant={packageId === pkg.packageId ? "solid" : "outline"}
                                                            onClick={() => setPackageId(pkg.packageId)}
                                                        >
                                                            {packageId === pkg.packageId ? "Selected" : "Select"}
                                                        </Button>
                                                        <Button
                                                            size="1"
                                                            variant="outline"
                                                            onClick={() => upgradeExtension(pkg)}
                                                            disabled={upgrading || !bytecode}
                                                        >
                                                            {upgrading ? <Spinner /> : "Upgrade"}
                                                        </Button>
                                                    </Flex>
                                                </Flex>
                                            </Card>
                                        ))}
                                    </Flex>
                                ) : (
                                    <Text color="gray">No extension packages found. Deploy one first!</Text>
                                )}
                            </Flex>
                        </Card>
                    </Tabs.Content>

                    {/* Deploy Tab */}
                    <Tabs.Content value="deploy">
                        <Card>
                            <Flex direction="column" gap="4" p="4">
                                <Text weight="bold">Deploy New Extension</Text>

                                {/* Deployment Type Selection */}
                                <RadioGroup.Root
                                    value={deployType}
                                    onValueChange={(value) => setDeployType(value as "default" | "custom")}
                                >
                                    <Flex direction="column" gap="3">
                                        <Flex align="center" gap="2">
                                            <RadioGroup.Item value="default" id="default-deploy" />
                                            <Text size="2" weight="bold">Use Default Extension Templates</Text>
                                        </Flex>
                                        <Flex align="center" gap="2" >
                                            <RadioGroup.Item value="custom" id="custom-deploy" />
                                            <Text size="2" weight="bold">Use Custom Bytecode (turret.mv)</Text>
                                        </Flex>
                                    </Flex>
                                </RadioGroup.Root>

                                {deployType === "default" ? (
                                    // Default Templates Selection
                                    templatesLoading ? (
                                        <Flex align="center" gap="2" p="4">
                                            <Spinner />
                                            <Text>Loading extension templates...</Text>
                                        </Flex>
                                    ) : (
                                        <Box>
                                            <Text size="2" weight="medium" mb="2">Select Template:</Text>
                                            <Flex direction="column" gap="3">
                                                {bytecodeTemplates.map((template) => (
                                                    <Card
                                                        key={template.filename}
                                                        variant={selectedTemplate === template.filename ? "classic" : "surface"}
                                                        style={{ cursor: 'pointer' }}
                                                        onClick={() => setSelectedTemplate(template.filename)}
                                                    >
                                                        <Flex align="center" justify="between" wrap="wrap" gap="3">
                                                            <Box>
                                                                <Text size="3" weight="bold">{template.name}</Text>
                                                                <Text size="2" color="gray">{template.description}</Text>
                                                                {template.bytecode && (
                                                                    <Text size="1" color="gray">Size: {template.bytecode.length} bytes</Text>
                                                                )}
                                                            </Box>
                                                            {selectedTemplate === template.filename && (
                                                                <Badge color="green" size="2">Selected</Badge>
                                                            )}
                                                        </Flex>
                                                    </Card>
                                                ))}
                                            </Flex>
                                        </Box>
                                    )
                                ) : (
                                    // Custom Bytecode Section - Just shows status of turret.mv
                                    <Box>
                                        <Flex direction="column" gap="2">
                                            <Text size="2" weight="medium">Custom Bytecode (turret.mv):</Text>
                                            <Card variant="surface">
                                                <Flex align="center" gap="2" p="2">
                                                    {bytecode ? (
                                                        <>
                                                            <Badge color="green" size="2">✓ Loaded</Badge>
                                                            <Text size="2">turret.mv ({bytecode.length} bytes)</Text>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Badge color="yellow" size="2">⚠ Not Loaded</Badge>
                                                            <Text size="2">Waiting for turret.mv to load...</Text>
                                                        </>
                                                    )}
                                                </Flex>
                                            </Card>
                                            <Text size="1" color="gray">
                                                Uses the default turret.mv bytecode from /bytecode/turret.mv
                                            </Text>
                                        </Flex>
                                    </Box>
                                )}

                                {/* Deploy Button */}
                                <Flex gap="3" align="center">
                                
                                    <Button
                                        onClick={async () => {
                                            if (deployType === "default") {
                                                const selected = bytecodeTemplates.find(t => t.filename === selectedTemplate);
                                                if (selected?.bytecode) {
                                                    // IMPORTANT: Set the bytecode to the template's bytecode
                                                    const templateBytecode = selected.bytecode;
                                                    const templateDigest = selected.digest;

                                                    // Call deploy with the template bytecode directly
                                                    await deployExtensionWithBytecode(templateBytecode, templateDigest);
                                                } else {
                                                    alert("Template not loaded yet");
                                                }
                                            } else {
                                                if (!bytecode) {
                                                    alert("Custom bytecode (turret.mv) not loaded yet");
                                                    return;
                                                }
                                                await deployExtension();
                                            }
                                        }}
                                        disabled={
                                            deploying ||
                                            !account ||
                                            (deployType === "default" ?
                                                !bytecodeTemplates.some(t => t.filename === selectedTemplate && t.bytecode) :
                                                !bytecode
                                            )
                                        }
                                        size="3"
                                    >
                                        {deploying && <Spinner />}
                                        Deploy Extension
                                    </Button>

                                    {deployType === "default" && bytecodeTemplates.some(t => t.filename === selectedTemplate && t.bytecode) && (
                                        <Text size="2" color="green">
                                            ✓ Template ready to deploy
                                        </Text>
                                    )}

                                    {deployType === "custom" && bytecode && (
                                        <Text size="2" color="green">
                                            ✓ Custom bytecode ready
                                        </Text>
                                    )}
                                </Flex>

                                {deployError && (
                                    <Text color="red" size="2">{deployError}</Text>
                                )}

                                {/* Info Box */}
                                <Box mt="2" p="3" style={{ backgroundColor: 'var(--gray-3)', borderRadius: '8px' }}>
                                    <Text size="1" color="gray">
                                        <strong>Deployment Options:</strong>
                                        <br />• <strong>Default Templates:</strong> Pre-configured behaviours ready to deploy
                                        <br />&nbsp;&nbsp;&nbsp;- Turret Owner Only: Only the turret owner will be not attacked by turret
                                        <br />&nbsp;&nbsp;&nbsp;- Turret Owner + Starting Corp: Owner and starting corporation members are ignored by turret
                                        <br />• <strong>Custom Bytecode:</strong> Use your own compiled turret.mv file from /bytecode/turret.mv
                                        <br /><br />

                                    </Text>
                                </Box>
                            </Flex>
                        </Card>
                    </Tabs.Content>

                    {/* Excluded Tab */}
                    <Tabs.Content value="excluded">
                        <Card>
                            <Flex direction="column" gap="4" p="4">
                                <Flex justify="between" align="center">
                                    <Text weight="bold">Excluded Characters & Tribes</Text>
                                    <Flex gap="2">
                                        <Button
                                            size="1"
                                            variant="outline"
                                            onClick={() => refetchExcludedConfig()}
                                            disabled={!excludedConfigId}
                                        >
                                            Refresh
                                        </Button>
                                        {adminCapId && (
                                            <Button
                                                size="1"
                                                variant="outline"
                                                onClick={syncConfigFromConstants}
                                                disabled={loadingExcluded}
                                            >
                                                {loadingExcluded ? <Spinner /> : "Sync from Constants"}
                                            </Button>
                                        )}
                                    </Flex>
                                </Flex>

                                {!excludedConfigId ? (
                                    <Card variant="surface">
                                        <Flex direction="column" gap="3" p="4" align="center">
                                            <Text size="2" color="gray">
                                                ExcludedConfig object not found. Select the package first.
                                            </Text>
                                        </Flex>
                                    </Card>
                                ) : !excludedConfig ? (
                                    <Flex justify="center" p="4">
                                        <Spinner />
                                        <Text ml="2">Loading excluded configuration...</Text>
                                    </Flex>
                                ) : (
                                    <>
                                        {/* Excluded Character IDs */}
                                        <Box>
                                            <Text weight="bold" size="2">Excluded Character IDs:</Text>
                                            {excludedCharacterIds.length > 0 ? (
                                                <Flex direction="column" gap="2" mt="2">
                                                    {excludedCharacterIds.map((id: number, idx: number) => (
                                                        <Card key={idx} variant="surface">
                                                            <Flex align="center" p="2">
                                                                <Box style={{ width: '30px' }}>
                                                                    <Text size="1" color="gray">#{idx + 1}</Text>
                                                                </Box>
                                                                <Code size="2">{id}</Code>
                                                            </Flex>
                                                        </Card>
                                                    ))}
                                                    <Text size="1" color="gray" mt="1">
                                                        Total: {excludedCharacterIds.length} excluded character(s)
                                                    </Text>
                                                </Flex>
                                            ) : (
                                                <Text size="2" color="gray" mt="2">
                                                    No excluded character IDs configured.
                                                </Text>
                                            )}
                                        </Box>

                                        {/* Separator */}
                                        {excludedTribes.length > 0 && (
                                            <Box height="1px" style={{ backgroundColor: 'var(--gray-4)' }} my="2" />
                                        )}

                                        {/* Excluded Tribes */}
                                        {excludedTribes.length > 0 && (
                                            <Box>
                                                <Text weight="bold" size="2">Excluded Tribe IDs:</Text>
                                                <Flex direction="column" gap="2" mt="2">
                                                    {excludedTribes.map((id: number, idx: number) => (
                                                        <Card key={idx} variant="surface">
                                                            <Flex align="center" p="2">
                                                                <Box style={{ width: '30px' }}>
                                                                    <Text size="1" color="gray">#{idx + 1}</Text>
                                                                </Box>
                                                                <Code size="2">{id}</Code>
                                                            </Flex>
                                                        </Card>
                                                    ))}
                                                </Flex>
                                            </Box>
                                        )}
                                    </>
                                )}

                                <Box mt="2" p="3" style={{ backgroundColor: 'var(--gray-3)', borderRadius: '8px' }}>
                                    <Text size="1" color="gray">
                                        <strong>Note:</strong>
                                        <br />" Excluded IDs are stored in the ExcludedConfig shared object
                                        <br />" The turret uses hardcoded constants (visible in bytecode) for exclusions
                                        <br />" After upgrading the module with new constants, click "Sync from Constants" to update the shared object
                                        <br />" AdminCap is required to sync the config
                                    </Text>
                                </Box>
                            </Flex>
                        </Card>
                    </Tabs.Content>
                </Box>
            </Tabs.Root>

            {/* Debug panel */}
            <Card mt="4">
                <Text size="2" weight="bold">Debug Info</Text>
                <Flex direction="column" gap="1" mt="2" style={{ fontSize: '11px', opacity: 0.7 }}>
                    <Text>Wallet: {account?.address || 'none'}</Text>
                    <Text>Profile: {playerProfile?.id || 'none'}</Text>
                    <Text>Character: {characterAccount || 'none'}</Text>
                    <Text>Character ID: {characterID || 'none'}</Text>
                    <Text>Tribe ID: {characterTribeID || 'none'}</Text>
                    <Text>OwnerCaps: {ownerCaps.length}</Text>
                    <Text>Turrets: {turrets.size}</Text>
                    <Text>Selected Package: {packageId || 'none'}</Text>
                    <Text>Packages Found: {deployedPackages?.length || 0}</Text>
                    <Text>Excluded Configs Loaded: {excludedConfigs.size}</Text>
                </Flex>
            </Card>
        </Container>
    );
}