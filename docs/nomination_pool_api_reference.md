## The Core Concept

A nomination pool **is itself a nominator** on-chain. It has its own stash account that bonds ENJ and votes for validators, exactly like any regular nominator. So confirming that a pool received a reward reduces to:

1. Knowing which validators the pool's stash nominated
2. Confirming those validators were active and earned points in that era
3. Confirming the pool's stash account received a `staking.Rewarded` event in the payout block for that era
4. Confirming the reward was bonded back into the stash (reinvestment)

---

## Step 1 — Get All Pools and Their Stash Addresses

```
POST https://enjin.api.subscan.io/api/scan/nomination_pool/pools
```
```json
{
    "multi_state": [
        "string"
    ],
    "state": "Destroying"
}
```

### Sample Request Body
```json
{
    "multi_state": [
        "Destroying","Open","Blocked","Destroyed"
    ]
}
```

### Sample Response Body
```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1772244386,
    "data": {
        "count": 98,
        "list": [
            {
                "pool_id": 0,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv4iM7kS86maPgbzmbFKZCzz2Uv7758",
                    "display": "Pool#0(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLTNfLYcmy2wnUjSXksVtqSrMeNbca",
                    "display": "Pool#0(Reward)"
                },
                "nominate_count": 7,
                "member_count": 213,
                "total_bonded": "79234258329214653112414254",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcCQCvf7TAVVtMU7UGRSafugENeCvJ",
                    "display": "Pool#0(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "32000000000000000000000000",
                "issued_staked_enj": "46464322138012152850226436",
                "commission": 0
            },
            {
                "pool_id": 1,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv4muyVPRtEaiqgxDa6puauWVQMeK5L",
                    "display": "Pool#1(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLWwX5VvZS3GwZgtWcNrGjyKH5v1vk",
                    "display": "Pool#1(Reward)"
                },
                "nominate_count": 4,
                "member_count": 181,
                "total_bonded": "35706148417060600647911062",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcFy4fcREdVq3SRZT7vnxaS99pBdgQ",
                    "display": "Pool#1(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "32000000000000000000000000",
                "issued_staked_enj": "21732103517963963457041381",
                "commission": 0
            }
        ]
    }
}
```

**Key response fields per pool:**
- `pool_id` — pool number (e.g. `10`)
- `pool_account.address` — the pool's bonded stash address (this is the key address for all further calls)
- `state` — must be `Open` or `Blocked` to be actively nominating

---

## Step 2 — Get Each Pool's Nominated Validators

Use the pool's stash address from Step 1:

```
POST https://enjin.api.subscan.io/api/scan/staking/voted
```
```json
{
  "address": "<pool_stash_address>"
}
```

### Sample Request Body
```json
{
    "address": "enD9wdMEaQa3LR6AUWQv4iM7kS86maPgbzmbFKZCzz2Uv7758"
}
```

### Sample Response Body
```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1772245011,
    "data": {
        "list": [
            {
                "rank_validator": 24,
                "bonded_nominators": "16748228818380272836483080",
                "bonded_owner": "15001999999999965198576",
                "count_nominators": 8,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enGD21jemwYWYiRZtQVXVonb5dkUSY3Sw8VEVnVg5jhM13VRK",
                    "parent": {
                        "address": "enE6ztuKEefP4CsGe2CTbhXhdJWhRsxnJgsWCGedaZFphPoks",
                        "display": "Subscan",
                        "sub_symbol": "validator01",
                        "identity": true
                    }
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "2736908634459349058243256",
                "active": true
            },
            {
                "rank_validator": 11,
                "bonded_nominators": "16570078633263157926206796",
                "bonded_owner": "191143980520234365012804",
                "count_nominators": 1,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enCYqG8iYjGeZ135nUWH6DpLUYdx7kYGASiheg16W164RZ747",
                    "parent": {
                        "address": "enBYZMyMB16Su7rns6qKFQ4fLHgCa6fpURb2vFNHTetXXGNNa",
                        "display": "Matrixed.Link",
                        "sub_symbol": "2",
                        "identity": true
                    }
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "16570078633263157926206796",
                "active": true
            }
        ]
    }
}
```


**Key response fields:**
- `list[].stash_account_display.address` — validator stash address being nominated
- `list[].bonded` — total bonded to that validator from this pool
- `list[].status` — whether the validator is currently active. Treat `""` as active.

This tells you definitively which validators each pool is voting for.

---

## Step 3 — Map the Target Era to a Block Range

```
POST https://enjin.api.subscan.io/api/scan/staking/era_stat
```
```json
{
  "address": "<validator_stash_address>",
  "page": 0,
  "row": 20
}
```

### Sample Request Body
```json
{
    "address": "enGD21jemwYWYiRZtQVXVonb5dkUSY3Sw8VEVnVg5jhM13VRK",
    "page": 0,
    "row": 20
}
```

### Sample Response Body
```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1772245278,
    "data": {
        "count": 808,
        "list": [
            {
                "era": 984,
                "start_block_num": 14394390,
                "end_block_num": 14396787,
                "reward": "0",
                "slash": "0",
                "block_produced": "14394480,14394510,14394541,14394542,14394555,14394579,14394581,14394607,14394638,14394652,14394704,14394706,14394707,14394730,14394732,14394748,14394767,14394786,14394790,14394807,14394809,14394879,14394973,14394990,14394999,14395032,14395040,14395044,14395116,14395165,14395241,14395251,14395284,14395422,14395449,14395465,14395477,14395485,14395489,14395502,14395517,14395528,14395557,14395589,14395613,14395620,14395634,14395642,14395654,14395784,14395793,14395795,14395818,14395899,14395959,14395960,14395996,14396031,14396034,14396048,14396079,14396103,14396109,14396131,14396141,14396144,14396168,14396183,14396245,14396247,14396270,14396280,14396290,14396308,14396330,14396392,14396410,14396441,14396549,14396575,14396584,14396599,14396646,14396690,14396705,14396727,14396783",
                "reward_point": 0
            },
            {
                "era": 983,
                "start_block_num": 14379991,
                "end_block_num": 14394389,
                "reward": "0",
                "slash": "0",
                "block_produced": "14380085,14380090,14380100,14380118,14380142,14380183,14380201,14380202,14380249,14380269,14380298,14380310,14380315,14380343,14380357,14380366,14380367,14380433,14380460,14380535,14380554,14380559,14380583,14380590,14380607,14380608,14380617,14380724,14380725,14380746,14380757,14380782,14380805,14380833,14380846,14380860,14380873,14380886,14380922,14381027,14381067,14381108,14381129,14381194,14381225,14381233,14381282,14381289,14381302,14381313,14381321,14381341,14381351,14381420,14381448,14381485,14381489,14381492,14381497,14381520,14381535,14381594,14381615,14381618,14381643,14381697,14381701,14381793,14381829,14381853,14381861,14381866,14381871,14381874,14381911,14381939,14381943,14381950,14381959,14381961,14381981,14382013,14382030,14382066,14382075,14382084,14382094,14382100,14382106,14382134,14382137,14382139,14382140,14382141,14382168,14382235,14382253,14382268,14382290,14382327,14382343,14382354,14382378,14382438,14382492,14382529,14382538,14382598,14382633,14382643,14382673,14382715,14382729,14382737,14382738,14382758,14382760,14382772,14382788,14382790,14382795,14382808,14382811,14382846,14382875,14382898,14382914,14382915,14382932,14382938,14382957,14382959,14382986,14382989,14383024,14383032,14383074,14383095,14383105,14383136,14383148,14383158,14383230,14383235,14383274,14383307,14383314,14383338,14383350,14383386,14383392,14383393,14383394,14383434,14383450,14383489,14383490,14383493,14383532,14383608,14383678,14383686,14383693,14383711,14383728,14383735,14383747,14383802,14383835,14383840,14383841,14383863,14383883,14383897,14383968,14383987,14384004,14384026,14384031,14384038,14384050,14384163,14384208,14384234,14384264,14384326,14384357,14384389,14384393,14384429,14384469,14384490,14384516,14384527,14384565,14384587,14384637,14384682,14384691,14384764,14384789,14384807,14384821,14384886,14384901,14384907,14384908,14384910,14384936,14384938,14384981,14385016,14385046,14385177,14385206,14385224,14385293,14385312,14385321,14385336,14385344,14385345,14385352,14385370,14385389,14385392,14385423,14385444,14385448,14385489,14385493,14385498,14385509,14385515,14385540,14385541,14385560,14385691,14385726,14385767,14385805,14385829,14385854,14385864,14385871,14385873,14385911,14385917,14386006,14386042,14386069,14386074,14386091,14386099,14386105,14386107,14386127,14386158,14386160,14386161,14386184,14386202,14386276,14386284,14386290,14386321,14386376,14386385,14386424,14386453,14386465,14386489,14386495,14386516,14386530,14386535,14386545,14386588,14386609,14386668,14386723,14386757,14386774,14386777,14386791,14386803,14386810,14386844,14386865,14386944,14387029,14387045,14387048,14387070,14387074,14387117,14387160,14387206,14387222,14387337,14387339,14387353,14387364,14387402,14387403,14387416,14387478,14387486,14387517,14387544,14387577,14387612,14387645,14387665,14387695,14387757,14387820,14387837,14387839,14387847,14387907,14387914,14387934,14387957,14387966,14388018,14388024,14388052,14388076,14388080,14388125,14388156,14388195,14388206,14388282,14388291,14388312,14388327,14388340,14388378,14388413,14388418,14388444,14388456,14388479,14388480,14388492,14388511,14388512,14388517,14388592,14388596,14388598,14388607,14388619,14388634,14388635,14388647,14388656,14388665,14388713,14388797,14388837,14388840,14388871,14388872,14388891,14388970,14389032,14389042,14389112,14389143,14389156,14389157,14389185,14389228,14389252,14389253,14389288,14389305,14389396,14389431,14389433,14389436,14389437,14389492,14389535,14389588,14389596,14389744,14389759,14389861,14389903,14389917,14389932,14389978,14390055,14390056,14390067,14390125,14390144,14390159,14390253,14390258,14390286,14390341,14390367,14390403,14390423,14390462,14390471,14390507,14390557,14390570,14390602,14390608,14390618,14390619,14390625,14390629,14390644,14390659,14390664,14390668,14390680,14390695,14390706,14390734,14390771,14390783,14390805,14390811,14390848,14390863,14390880,14390882,14390884,14390925,14390946,14390947,14390964,14390997,14391002,14391027,14391060,14391065,14391081,14391091,14391128,14391145,14391197,14391214,14391222,14391239,14391245,14391332,14391386,14391395,14391418,14391450,14391480,14391532,14391562,14391568,14391575,14391581,14391594,14391598,14391651,14391676,14391683,14391721,14391729,14391740,14391748,14391832,14391845,14391952,14391968,14391989,14392006,14392076,14392090,14392091,14392097,14392111,14392144,14392206,14392220,14392236,14392237,14392248,14392259,14392346,14392365,14392390,14392414,14392429,14392432,14392434,14392435,14392443,14392471,14392484,14392485,14392540,14392543,14392551,14392580,14392601,14392626,14392639,14392662,14392673,14392678,14392682,14392732,14392751,14392756,14392764,14392795,14392798,14392805,14392811,14392889,14392926,14392950,14392956,14392958,14392965,14392977,14392979,14393028,14393097,14393150,14393186,14393193,14393208,14393238,14393262,14393284,14393320,14393336,14393390,14393415,14393467,14393485,14393486,14393488,14393502,14393508,14393520,14393540,14393569,14393606,14393625,14393630,14393673,14393720,14393736,14393756,14393804,14393815,14393820,14393833,14393870,14393897,14393928,14393933,14393934,14393940,14393995,14393996,14394002,14394042,14394085,14394100,14394102,14394111,14394131,14394133,14394142,14394153,14394186,14394239,14394287,14394290,14394330,14394364",
                "reward_point": 11780
            }
        ]
    }
}
```

**Key response fields:**
- `era` — era number
- `start_block_num` / `end_block_num` — block range for that era

You'll use the block range in the next step to filter events precisely to a specific era. Format it as `"<start>-<end>"` for the `block_range` parameter.

Example:
- Era: 979, Block Range: 14323100-14337499
- Era: 980, Block Range: 14337500-14351890
- Era: 981, Block Range: 14351891-14365931
- Era: 982, Block Range: 14365932-14379990
- Era: 983, Block Range: 14379991-14394389

Check three validators from Step 2 to confirm the era's block range is consistent across all nominated validators. If they differ, check again another validator until you find a consistent block range for that era. This is your anchor for filtering reward events in the next step.

---

## Step 4 — Confirm the Pool Received a Staking Reward in That Era

This is the primary confirmation call. Use the **pool's stash address** (not a member's address):

```
POST https://enjin.api.subscan.io/api/v2/scan/account/reward_slash
```
```json
{
  "address": "<pool_stash_address>",
  "is_stash": true,
  "category": "Reward",
  "block_range": "14400000-14414400",
  "page": 0,
  "row": 100
}
```

### Sample Request Body
```json
{
    "address": "enGD21jemwYWYiRZtQVXVonb5dkUSY3Sw8VEVnVg5jhM13VRK",
    "block_range": "14379991-14394389",
    "category": "Reward",
    "is_stash": true,
    "page": 0,
    "row": 100
}
```

### Sample Response Body
```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1772245708,
    "data": {
        "count": 1,
        "list": [
            {
                "era": 982,
                "stash": "enGD21jemwYWYiRZtQVXVonb5dkUSY3Sw8VEVnVg5jhM13VRK",
                "account": "enEY4a8yf6DorZ7HMxddt8S9PhfeeSnUJpVogEnYPevnYbg4D",
                "validator_stash": "enGD21jemwYWYiRZtQVXVonb5dkUSY3Sw8VEVnVg5jhM13VRK",
                "amount": "500351448504894746317",
                "block_timestamp": 1772133774,
                "event_index": "14380081-7",
                "module_id": "Staking",
                "event_id": "Rewarded",
                "extrinsic_index": "14380081-2",
                "invalid_era": false
            }
        ]
    }
}
```

**Key response fields per list item:**
- `era` — era number (should match your target era)
- `amount` — ENJ reward received by the pool (in Plancks)
- `block_timestamp` — Unix timestamp of payout
- `event_index` — unique identifier for this specific event
- `module_id` / `event_id` — should be `Staking` / `Rewarded`
- `stash` — confirms it's the pool's stash address
- `extrinsic_index` — the extrinsic that triggered the reward (useful for cross-referencing in Step 5)

**Interpretation:**
- The era reward for the block range we are getting is actually 1 era behind. So for example, I queried for the block range of era 983, the reward I will get from the https://enjin.api.subscan.io/api/v2/scan/account/reward_slash would be for era 982.
- If a record **exists** in the era's block range → the pool received a reward from its nominated active validator ✅
- If **no record** exists → the pool either nominated no active validator that era, or all its nominated validators were inactive/slashed ❌
- Use the `validator_stash` field to confirm the reward came from one of the validators you identified in Step 2 and the `era` field to confirm it falls within the era you mapped in Step 3. This triangulation confirms the reward is directly tied to the pool's nomination activity for that era.

---

## Summary Table

| Goal | Endpoint | Key Param |
|---|---|---|
| Get all pools + stash addresses | `POST /api/scan/nomination_pool/pools` | `page`, `row` |
| Get validators each pool nominates | `POST /api/scan/staking/voted` | `address` = pool stash |
| Map era to block range | `POST /api/scan/staking/era_stat` | `address` = validator stash |
| Confirm pool received staking reward | `POST /api/scan/account/reward_slash` | `address` = pool stash, `block_range`, `is_stash: true` |

---

## Important Note on `block_range`

The `block_range` parameter in `account/reward_slash` is what makes this efficient — instead of paginating through hundreds of reward records and filtering client-side, you pass the era's exact block range (e.g. `"14400000-14414400"`) and the API returns only events within that window. Always get the era's block range from `era_stat` first as your anchor.