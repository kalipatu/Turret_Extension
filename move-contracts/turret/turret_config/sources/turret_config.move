#[allow(implicit_const_copy, unused_variable)]

module turret_config::turret;

use sui::bcs;
use sui::event;
use world::character::Character;
use world::turret::{Self, Turret, OnlineReceipt, ReturnTargetPriorityList};

// Hardcoded list of IDs to exclude from priority list

const EXCLUDED_CHARACTER_IDS: vector<u32> = vector[
    2112077465, // Kalipatu
    2112077495, // Unknown
    // Add more character IDs here as needed
    // Example: 1234567890,
];

const EXCLUDED_CHARACTER_TRIBES: vector<u32> = vector[
    //1000167, //clonebank 86 - start corp cy5
    //345,
    //678,
    // Add more character IDs here as needed
    // Example: 1234567890,
];

// Shared object that stores the data - visible on SuiScan and can be used for dapp
public struct ExcludedConfig has key, store {
    id: UID,
    character_ids: vector<u32>,
    tribe_ids: vector<u32>,
}

#[error(code = 0)]
const EInvalidOnlineReceipt: vector<u8> = b"Invalid online receipt";

public struct PriorityListUpdatedEvent has copy, drop {
    turret_id: ID,
    priority_list: vector<u8>,
}

public struct TurretAuth has drop {}

// Add admin capability if you haven't already
public struct AdminCap has key, store {
    id: UID,
}

// Initialize with data from constants
fun init(ctx: &mut TxContext) {
    let admin_cap = AdminCap { id: object::new(ctx) };
    transfer::transfer(admin_cap, ctx.sender());

    transfer::share_object(ExcludedConfig {
        id: object::new(ctx),
        character_ids: EXCLUDED_CHARACTER_IDS,
        tribe_ids: EXCLUDED_CHARACTER_TRIBES,
    });
}

// Public function to get excluded addresses - useful for dapps
public fun get_excluded_addresses(): vector<u32> {
    EXCLUDED_CHARACTER_IDS
}

// Public function to get excluded addresses - useful for dapps
public fun get_excluded_tribes(): vector<u32> {
    EXCLUDED_CHARACTER_TRIBES
}

// View functions - read from stored data
public fun get_excluded_character_ids(config: &ExcludedConfig): vector<u32> {
    config.character_ids
}

public fun get_excluded_tribe_ids(config: &ExcludedConfig): vector<u32> {
    config.tribe_ids
}

// Add this event
public struct ExcludedIdsEvent has copy, drop {
    ids: vector<u32>,
}

public fun sync_config_from_constants(
    _: &AdminCap, // You'll need to add AdminCap
    config: &mut ExcludedConfig,
) {
    config.character_ids = EXCLUDED_CHARACTER_IDS;
    config.tribe_ids = EXCLUDED_CHARACTER_TRIBES;
}

// Add this function that emits an event with the IDs
public fun emit_excluded_ids(config: &ExcludedConfig) {
    event::emit(ExcludedIdsEvent {
        ids: get_excluded_character_ids(config),
    });
}

public fun get_target_priority_list(
    turret: &Turret,
    owner_character: &Character,
    target_candidate_list: vector<u8>,
    receipt: OnlineReceipt,
): vector<u8> {
    assert!(receipt.turret_id() == object::id(turret), EInvalidOnlineReceipt);

    let candidates = turret::unpack_candidate_list(target_candidate_list);

    let mut return_list = vector::empty<ReturnTargetPriorityList>();
    let mut i = 0u64;
    let len = vector::length(&candidates);

    let owner_character_id = owner_character.key().item_id() as u32;

    let mut excluded_count = 0u64;

    while (i < len) {
        let target_candidate = vector::borrow(&candidates, i);
        let target_character_id = target_candidate.character_id();
        let target_tribe_id = target_candidate.character_tribe();

        let is_owner = target_character_id != 0 && target_character_id == owner_character_id;

        if (is_owner) {
            excluded_count = excluded_count + 1;
        } else {
            // Only check exclusion lists if not owner
            let is_excluded_by_id = is_character_id_excluded(target_character_id);
            let is_excluded_by_tribe = is_tribe_id_excluded(target_tribe_id);

            if (is_excluded_by_id || is_excluded_by_tribe) {
                excluded_count = excluded_count + 1;
            } else {
                let priority_entry = turret::new_return_target_priority_list(
                    turret::item_id(target_candidate),
                    10000,
                );
                vector::push_back(&mut return_list, priority_entry);
            };
        };

        i = i + 1;
    };

    let result = bcs::to_bytes(&return_list);

    turret::destroy_online_receipt(receipt, TurretAuth {});
    event::emit(PriorityListUpdatedEvent {
        turret_id: object::id(turret),
        priority_list: result,
    });
    result
}

// Helper function to check if a character ID is excluded
public fun is_character_id_excluded(character_id: u32): bool {
    let mut i = 0;
    let len = vector::length(&EXCLUDED_CHARACTER_IDS);

    while (i < len) {
        let excluded_id = vector::borrow(&EXCLUDED_CHARACTER_IDS, i);
        if (*excluded_id == character_id) {
            return true
        };
        i = i + 1;
    };

    false
}


// Helper function to check if a tribe ID is excluded (using constants)
public fun is_tribe_id_excluded(tribe_id: u32): bool {
    let mut i = 0;
    let len = vector::length(&EXCLUDED_CHARACTER_TRIBES);

    while (i < len) {
        let excluded_id = vector::borrow(&EXCLUDED_CHARACTER_TRIBES, i);
        if (*excluded_id == tribe_id) {
            return true
        };
        i = i + 1;
    };

    false
}
