## Step 1 — Get All Pools and Their Stash Addresses

```
POST https://enjin.api.subscan.io/api/scan/nomination_pool/pools
```

## Request Body
```json
{
    "multi_state": [
        "Destroying","Open","Blocked","Destroyed"
    ]
}
```

### Response Body
```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1772261183,
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
            },
            {
                "pool_id": 2,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv4qUqELjfhb3zmufYxLFxp2xKoBcAC",
                    "display": "Pool#2(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLaWNpTELu3c6eeLVTtCeeVnCXTSBU",
                    "display": "Pool#2(Reward)"
                },
                "nominate_count": 3,
                "member_count": 181,
                "total_bonded": "35746953393432088200252320",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcKXvQZj26WACXP1RyS9LUxc5Fj279",
                    "display": "Pool#2(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "31500000000000000000000000",
                "issued_staked_enj": "21468547581868458147052290",
                "commission": 0
            },
            {
                "pool_id": 3,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv4u3gyJ3TAbP9rs7XoqcLiZRFEiy8N",
                    "display": "Pool#3(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLe5EZQY8N3wFjbnUKPZ2Z2F7xzV2M",
                    "display": "Pool#3(Reward)"
                },
                "nominate_count": 2,
                "member_count": 373,
                "total_bonded": "24830863436947637816182164",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcP6n9X2oZWVMcLTQpwViPV4zhGEMh",
                    "display": "Pool#3(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "16000000000000000000000000",
                "issued_staked_enj": "14229138407939703849556260",
                "commission": 0
            },
            {
                "pool_id": 4,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv4xcYiFMEdbiJwpZWfLxid5tAgGRE5",
                    "display": "Pool#4(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLhe6JMquq4GQpZETAtuQTYi3QXytA",
                    "display": "Pool#4(Reward)"
                },
                "nominate_count": 2,
                "member_count": 780,
                "total_bonded": "16382856250475936663468618",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcSfdtULb2WpWhHuPgSr6J1Xv8oUdR",
                    "display": "Pool#4(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "10000000000000000000000000",
                "issued_staked_enj": "9671446688002228014128492",
                "commission": 0
            },
            {
                "pool_id": 5,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv52BQTCf26c3U2n1VWrK6XcM67obJZ",
                    "display": "Pool#5(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLmCx3K9hJ4bZuWgS2QFnN5Axr5D3A",
                    "display": "Pool#5(Reward)"
                },
                "nominate_count": 2,
                "member_count": 608,
                "total_bonded": "18993121116390927878113144",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcWEVdReNVX9fnFMNXxCUCXzqaM2Cu",
                    "display": "Pool#5(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "15000000000000000000000000",
                "issued_staked_enj": "11184207679178666494744575",
                "commission": 0
            },
            {
                "pool_id": 6,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv55kGC9xoZcNd7jTUNMfUS8p1ZM8Wg",
                    "display": "Pool#6(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLpmonGTUm4vizU8QsucAGbdtHcYsd",
                    "display": "Pool#6(Reward)"
                },
                "nominate_count": 2,
                "member_count": 57,
                "total_bonded": "28661124093324769241624922",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcZoMNNx9xXUpsCoMPTYr74Tm1tJEm",
                    "display": "Pool#6(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "10000000000000000000000000",
                "issued_staked_enj": "17529509992311447970176931",
                "commission": 0
            },
            {
                "pool_id": 7,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv59K7w7Gb2chnCguTDs1rLfGvztAJ3",
                    "display": "Pool#7(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLtLfXDmGE5Ft5RaPjQxYB86ojA3wg",
                    "display": "Pool#7(Reward)"
                },
                "nominate_count": 2,
                "member_count": 763,
                "total_bonded": "11968724019334907073837670",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcdND7LFwRXoyxAFLExuE1avgTRXii",
                    "display": "Pool#7(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "10000000000000000000000000",
                "issued_staked_enj": "7321731662802740310205555",
                "commission": 0
            },
            {
                "pool_id": 8,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5Csyg4aNVd2wHeMS5NNEFBjrSRTzj",
                    "display": "Pool#8(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvLwuXGB53h5b3AP2NavJv5eZjAhKkP",
                    "display": "Pool#8(Reward)"
                },
                "nominate_count": 1,
                "member_count": 245,
                "total_bonded": "6630754208003122911101284",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcgw4rHZitY9937hK6UFbv7PbtxjhV",
                    "display": "Pool#8(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "5000000000000000000000000",
                "issued_staked_enj": "3870174796332056153706345",
                "commission": 0
            },
            {
                "pool_id": 9,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5GSqR1t9xdN6NboQvsic9iCmsxsdR",
                    "display": "Pool#9(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvM1UP18NqA5vCFLUMSRfHzB2ecEhKb",
                    "display": "Pool#9(Reward)"
                },
                "nominate_count": 1,
                "member_count": 320,
                "total_bonded": "8656143579528174776316889",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvckVvbEsWMYUJ859HwybypdrXLW4S6",
                    "display": "Pool#9(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "5000000000000000000000000",
                "issued_staked_enj": "4771808522973632666367338",
                "commission": 0
            },
            {
                "pool_id": 10,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5L1h9yBwRdhFTZFPnP4z4EfhKWCr4",
                    "display": "Pool#10(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvM53Ek5gcd6FMLHvLHw1fthVa3mxDY",
                    "display": "Pool#10(Reward)"
                },
                "nominate_count": 2,
                "member_count": 190,
                "total_bonded": "24526564085653542205423754",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcp4nLCBHpYoTD2bGoUxMjAKSn3XSs",
                    "display": "Pool#10(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "20000000000000000000000000",
                "issued_staked_enj": "15591912181177596829839488",
                "commission": 0
            },
            {
                "pool_id": 11,
                "metadata": "",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5PaYtvVite2QYWhNdtRMxm8cm3c8P",
                    "display": "Pool#11(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvM8c6V2zQ66aWRFNK9SN3oDxVVK8NJ",
                    "display": "Pool#11(Reward)"
                },
                "nominate_count": 2,
                "member_count": 473,
                "total_bonded": "16508518891261778454895548",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcsde59V5HZ8cHz3FezJjdgnNDaxtU",
                    "display": "Pool#11(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "15000000000000000000000000",
                "issued_staked_enj": "10523233614518771493157619",
                "commission": 0
            },
            {
                "pool_id": 12,
                "metadata": "Mythic Mana Pool",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5T9QdsoWMeMZdU9MVPmjsHbYCapGo",
                    "display": "Pool#12(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMCAxDzJBZ6ufWCpHzwiRhkRQvrg6a",
                    "display": "Pool#12(Reward)"
                },
                "nominate_count": 2,
                "member_count": 1040,
                "total_bonded": "14826489828682667984304127",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvcwCVp6nrkZTmNwVEWVf7YDFHf88tP",
                    "display": "Pool#12(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "15000000000000000000000000",
                "issued_staked_enj": "9732066780488529025758878",
                "commission": 0
            },
            {
                "pool_id": 13,
                "metadata": "Etherscape #1",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5WiGNq7HpegiiRbLLu87mp4Te8LND",
                    "display": "Pool#13(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMFjoxwby27EpbAGGrT4ocGtLNPpVo",
                    "display": "Pool#13(Reward)"
                },
                "nominate_count": 2,
                "member_count": 912,
                "total_bonded": "6824069437239172442624520",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvczmMZ46eDZnvTtwDN11VSjiD6fNhx",
                    "display": "Pool#13(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "4000000000000000000000000",
                "issued_staked_enj": "3819941695872703499176458",
                "commission": 100000000
            },
            {
                "pool_id": 14,
                "metadata": "Liqusenj.io #1",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5aH87nR5Hf1soP3KCQUVgLXP5fgAC",
                    "display": "Pool#14(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMKJfhtukV7Zyg7iFhxRBWoMFowM59",
                    "display": "Pool#14(Reward)"
                },
                "nominate_count": 1,
                "member_count": 630,
                "total_bonded": "4667059566647196751065891",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvd4LDJ1QRga85YrPCDWMsMGB8YCfzw",
                    "display": "Pool#14(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "2499841097855069775989424",
                "commission": 100000000
            },
            {
                "pool_id": 15,
                "metadata": "ENJ Beam Club",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5dqyrjirkfM2tLVJ3upsarzJXD3fQ",
                    "display": "Pool#15(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMNsXSrDXx7u8m5AEZTmZRKpBFUgqj",
                    "display": "Pool#15(Reward)"
                },
                "nominate_count": 2,
                "member_count": 688,
                "total_bonded": "3431714776122983867433102",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvd7u52xiD9aTEdoqB51iFFne3yk1u2",
                    "display": "Pool#15(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "1897638427264638720860512",
                "commission": 100000000
            },
            {
                "pool_id": 16,
                "metadata": "Bad Bears",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5hQqbh2eDfgByHwGuRBFVPTDxkLDa",
                    "display": "Pool#16(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMSSPBoXKR8EHr2cDQy7wKrH6h1hKH",
                    "display": "Pool#16(Reward)"
                },
                "nominate_count": 1,
                "member_count": 872,
                "total_bonded": "4244436020978124783800817",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdBTvmv1zcanPimH9vX4dAK6yRHQ1k",
                    "display": "Pool#16(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "2341658357907695762622177",
                "commission": 100000000
            },
            {
                "pool_id": 17,
                "metadata": "FFT Pool Party",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5kyhLeLRgg1M4FPFkvXdPuv9QHRJN",
                    "display": "Pool#17(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMW1Evkq6t8ZSvz4CGUUKENk28ZARy",
                    "display": "Pool#17(Reward)"
                },
                "nominate_count": 0,
                "member_count": 910,
                "total_bonded": "3032231092259577501872309",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdF2nWsKn5b7Yoij8n2R14qZtrph7c",
                    "display": "Pool#17(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "1810094165349338207267473",
                "commission": 100000000
            },
            {
                "pool_id": 18,
                "metadata": "The Resistance",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5pYZ5beD9gLW9CqEcRt1JSP4qpxpJ",
                    "display": "Pool#18(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMZa6fi8tM8tc1wWB7yph8uCwa6eDf",
                    "display": "Pool#18(Reward)"
                },
                "nominate_count": 1,
                "member_count": 448,
                "total_bonded": "3461516090816634815210208",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdJbeFpdZYbShtgB7dXmNyN2pJNDZS",
                    "display": "Pool#18(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3000000000000000000000000",
                "issued_staked_enj": "2531133761569117813443643",
                "commission": 0
            },
            {
                "pool_id": 19,
                "metadata": "Xenomorph Hive",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5t7QpYwzcgffEAHDTwEPCxqzHNHkL",
                    "display": "Pool#19(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMd8xQfSfp9Dm6tx9yVB53Rfs1dihn",
                    "display": "Pool#19(Reward)"
                },
                "nominate_count": 1,
                "member_count": 52,
                "total_bonded": "1905800523023399575461896",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdNAVzmwM1bmrydd6V37kstVjjuJfd",
                    "display": "Pool#19(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1500000000000000000000000",
                "issued_staked_enj": "1411689756856013521071604",
                "commission": 0
            },
            {
                "pool_id": 20,
                "metadata": "Timekeeper Treasury",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv5wgGZWFn5gzpK7jCKSam7VJuiuY3N",
                    "display": "Pool#20(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMghp9ckTH9YvBrQ8pzXSwx8nTB12Y",
                    "display": "Pool#20(Reward)"
                },
                "nominate_count": 1,
                "member_count": 181,
                "total_bonded": "1496624032466955494466284",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdRjMjjF8Uc724b55LYU8nQxfBSw8G",
                    "display": "Pool#20(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1250000000000000000000000",
                "issued_staked_enj": "1042245415491048540966852",
                "commission": 0
            },
            {
                "pool_id": 21,
                "metadata": "Plasma Pulse Pool",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv61F8JTZZYhKyQ5BBAww921mqASnvQ",
                    "display": "Pool#21(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMkGfta4Ek9t5Gor7gVsprUbhtiQTr",
                    "display": "Pool#21(Reward)"
                },
                "nominate_count": 1,
                "member_count": 153,
                "total_bonded": "639724854602706866466123",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdVJDUgYuwcSB9YX4C3pWgwRaczBg2",
                    "display": "Pool#21(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1250000000000000000000000",
                "issued_staked_enj": "469503078121567177671018",
                "commission": 0
            },
            {
                "pool_id": 22,
                "metadata": "Voidwalker Vault",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv64oz3QsM1hf8V2dA2THWvYEkbz4M8",
                    "display": "Pool#22(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMoqXdXN2DADEMmJ6Y1ECm14dLFjcj",
                    "display": "Pool#22(Reward)"
                },
                "nominate_count": 1,
                "member_count": 295,
                "total_bonded": "3352776272356782365748631",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdYs5DdrhQcmLEVy33ZAtbTtW4XGz8",
                    "display": "Pool#22(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "2365041255430882277525965",
                "commission": 0
            },
            {
                "pool_id": 23,
                "metadata": "Galactic Glitch Guild",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv68NqnNB8UhzHZz58sxdtq4hg3XU5o",
                    "display": "Pool#23(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMsQPNUfogAYPSik5PWaafXXYmo7DB",
                    "display": "Pool#23(Reward)"
                },
                "nominate_count": 1,
                "member_count": 176,
                "total_bonded": "2215882851296961723059947",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdcRvxbAUsd6VKTR1u4XGVzMRW4enV",
                    "display": "Pool#23(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1750000000000000000000000",
                "issued_staked_enj": "1680725435101404087893856",
                "commission": 0
            },
            {
                "pool_id": 24,
                "metadata": "Oracle Overload",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6BwhXKUuwiKSewX7jTzGjbAbV4vYp",
                    "display": "Pool#24(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMvyF7Ryb9AsYXgC4F1vxa3zUDLdVc",
                    "display": "Pool#24(Reward)"
                },
                "nominate_count": 1,
                "member_count": 202,
                "total_bonded": "1525774136075067546492102",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdfznhYUGLdReQQrzkZseQWpLwbxZ8",
                    "display": "Pool#24(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1750000000000000000000000",
                "issued_staked_enj": "1072957457195791741646287",
                "commission": 0
            },
            {
                "pool_id": 25,
                "metadata": "Phantom Pixel Pool",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6FWZGGnhQiebjty6ayLee7dWvcCQt",
                    "display": "Pool#25(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvMzY6rPHNcBChcde36XHLUaTPeskKw",
                    "display": "Pool#25(Reward)"
                },
                "nominate_count": 1,
                "member_count": 158,
                "total_bonded": "2663478770315007791329579",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdjZeSVn3odkoVNJyc5E2K3HGP9R1B",
                    "display": "Pool#25(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2750000000000000000000000",
                "issued_staked_enj": "2051473956983677433343267",
                "commission": 0
            },
            {
                "pool_id": 26,
                "metadata": "Nebula Nook",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6K5R1E6UsiykprR5SUh2Ye6SN9b4G",
                    "display": "Pool#26(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvN46xbLbA5BXrhb61x2diP6vK6QzD2",
                    "display": "Pool#26(Reward)"
                },
                "nominate_count": 1,
                "member_count": 134,
                "total_bonded": "1272238285669806650661003",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdo8WBT5qGe5xaKkxTaaQDZkBpgn41",
                    "display": "Pool#26(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1000000000000000000000000",
                "issued_staked_enj": "967530177650026580119052",
                "commission": 100000000
            },
            {
                "pool_id": 27,
                "metadata": "Interstellar Icebox",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6NeGkBQGLjJuuos4Hz3QTAZMogwTw",
                    "display": "Pool#27(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvN7fpLHtwYBs1nYXzoXz6HdPEXxWXb",
                    "display": "Pool#27(Reward)"
                },
                "nominate_count": 1,
                "member_count": 104,
                "total_bonded": "2759471215416720239030501",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdrhMvQPcjeR7fHCwK5vn86D7GDwKd",
                    "display": "Pool#27(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3000000000000000000000000",
                "issued_staked_enj": "2200190924985281217542503",
                "commission": 0
            },
            {
                "pool_id": 28,
                "metadata": "Etherscape #2",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6SD8V8i3oje4zmK39VPnMh2HFDzM3",
                    "display": "Pool#28(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNBEg5FCj1CCAsVyyf3LUC9r9yVmFP",
                    "display": "Pool#28(Reward)"
                },
                "nominate_count": 1,
                "member_count": 30,
                "total_bonded": "1285663061304149927203862",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdvGDfMhQCekGkEevAbHA2cg2hmPe8",
                    "display": "Pool#28(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1000000000000000000000000",
                "issued_staked_enj": "999999237471210473648785",
                "commission": 100000000
            },
            {
                "pool_id": 29,
                "metadata": "Enjin Thunderdome",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6VmzE61qGjyE5im1zzkAGDVCgmZwA",
                    "display": "Pool#29(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNEoXpCWWUCXKxTRxWYgr6gK5R3GP3",
                    "display": "Pool#29(Reward)"
                },
                "nominate_count": 1,
                "member_count": 15,
                "total_bonded": "211030810329706870833780",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvdyq5QK1Bff5RqC6u26dXw98x9Jijg",
                    "display": "Pool#29(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1500000000000000000000000",
                "issued_staked_enj": "171362235717272471374907",
                "commission": 50000000
            },
            {
                "pool_id": 30,
                "metadata": "The Six Dragons: Stake & Drops",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6ZLqy3KcjkJPAgCzrW6YAjx88JeDN",
                    "display": "Pool#30(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNJNPZ9pHwCrV3QswN43E1CmzraWwq",
                    "display": "Pool#30(Reward)"
                },
                "nominate_count": 1,
                "member_count": 89,
                "total_bonded": "2792994525006480367119957",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQve3Pw9GJy8fQav9Yssbyuqfbsaqumy",
                    "display": "Pool#30(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3000000000000000000000000",
                "issued_staked_enj": "2196641273493981290702414",
                "commission": 100000000
            },
            {
                "pool_id": 31,
                "metadata": "Kepithor",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6cuhhzdQCkdYFdeyi1Sv5GR3ZrJ9s",
                    "display": "Pool#31(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNMwFJ785QDBe8NKvDZPbujEvJ7bmQ",
                    "display": "Pool#31(Reward)"
                },
                "nominate_count": 1,
                "member_count": 29,
                "total_bonded": "941890006928044790871820",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQve6xntDckbfjk16zrj7LHkC4o2PKUA",
                    "display": "Pool#31(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3000000000000000000000000",
                "issued_staked_enj": "705133069818751800640241",
                "commission": 100000000
            },
            {
                "pool_id": 32,
                "metadata": "Defiant Endurance",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6gUZSwwBfkxhLb6xZWoHynsy1PYb5",
                    "display": "Pool#32(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNRW734RrsDWoDKmu54jypFhqjfFYf",
                    "display": "Pool#32(Reward)"
                },
                "nominate_count": 1,
                "member_count": 8,
                "total_bonded": "3347247435189001642726953",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveAXedAvY4g4u64SqacgfeiXiTvbqo",
                    "display": "Pool#32(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2975000000000000000000000",
                "issued_staked_enj": "2772664882428323606662351",
                "commission": 0
            },
            {
                "pool_id": 33,
                "metadata": "Degen #13",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6k3RBuEy8mHrRYYwR29ftKLtSvraV",
                    "display": "Pool#33(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNV4xn1jeLDqxJHDsva6MinAmBCGSE",
                    "display": "Pool#33(Reward)"
                },
                "nominate_count": 1,
                "member_count": 23,
                "total_bonded": "3706056107254052508579990",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveE6WN8EKXgQ4B1tpS833ZEzduTzXy",
                    "display": "Pool#33(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3020000000000000000000000",
                "issued_staked_enj": "2895305666279418727476280",
                "commission": 100000000
            },
            {
                "pool_id": 34,
                "metadata": "0xe298a2efb88fe298a2efb88f44697a7a79204475636b7320506f6e64e298a2efb88fe298a2efb88f",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6ocGvrYkbmd1WVzvGXW3nqootU85D",
                    "display": "Pool#34(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNYdpWy3RoEB7PEfrn5SjdJdgcjj9J",
                    "display": "Pool#34(Reward)"
                },
                "nominate_count": 1,
                "member_count": 6,
                "total_bonded": "1454444930099159570548289",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveHfN75Y6zgjDFyLoHdPRTmTZM1Sux",
                    "display": "Pool#34(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1161000000000000000000000",
                "issued_staked_enj": "1160999395980275473384447",
                "commission": 100000000
            },
            {
                "pool_id": 35,
                "metadata": "All Time High",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6sB8forY4mxAbTSu82rRhNGjL1T2s",
                    "display": "Pool#35(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNcCgFvMDGEWGUC7qdao7Xq6c4H6CA",
                    "display": "Pool#35(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "7929896009791021241430",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveMEDr2qtTh4NLvnn98joNHvUnYmVc",
                    "display": "Pool#35(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "6688712725402476996414",
                "commission": 100000000
            },
            {
                "pool_id": 36,
                "metadata": "Degen #1526",
                "state": "Destroyed",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6vjzQmAKXnHKgQtsyYCobtjemYhtG",
                    "display": "Pool#36(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNfmXzsezjEqRZ9ZpV69VSMZXVpNL2",
                    "display": "Pool#36(Reward)"
                },
                "nominate_count": 0,
                "member_count": 1,
                "total_bonded": "1575855689429555078",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveQo5az9fvhPXRtEkze6BGpPQE5z9c",
                    "display": "Pool#36(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3088000000000000000000000",
                "issued_staked_enj": "0",
                "commission": 100000000
            },
            {
                "pool_id": 37,
                "metadata": "The Moon Club",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv6zJr9iU6zncUmNLrq3ZBWRCaD66fr",
                    "display": "Pool#37(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNjLPjpxnCFAae71oLbVsLt2SwMZzM",
                    "display": "Pool#37(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "293547158076799313216556",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveUMwKwTTPhigWqgjr9SZBLrKfdVED",
                    "display": "Pool#37(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "199794236985022195415776",
                "commission": 100000000
            },
            {
                "pool_id": 38,
                "metadata": "Degen #14",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv73shtfmtTnwdrKnqgYuZQwfVedJdH",
                    "display": "Pool#38(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNnuFUnGZfFVjj4TnC6rFFQVNNu2Va",
                    "display": "Pool#38(Reward)"
                },
                "nominate_count": 1,
                "member_count": 54,
                "total_bonded": "3564795140688687865204488",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveXvo4tmEri3qbo8ihenw5sKF7Aboc",
                    "display": "Pool#38(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2930000000000000000000000",
                "issued_staked_enj": "2908017041779561383291273",
                "commission": 100000000
            },
            {
                "pool_id": 39,
                "metadata": "Enjineering Gainz",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv77SZdd5fvoGnwHEpY4FwKU8R6Ai82",
                    "display": "Pool#39(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNrU7DjaM8Fptp1um3cCd9vxHpSP7i",
                    "display": "Pool#39(Reward)"
                },
                "nominate_count": 1,
                "member_count": 8,
                "total_bonded": "598885435259588520591918",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvebVeor52KiNzgkahZA9JzPnAYhtFj",
                    "display": "Pool#39(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "4661000000000000000000000",
                "issued_staked_enj": "466284131986735107196017",
                "commission": 100000000
            },
            {
                "pool_id": 40,
                "metadata": "Tokyo City Misfits ",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7B1RNaPTPobx2EgoPZcKDzbLXi3jj",
                    "display": "Pool#40(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNv2xxgt8bGA3tyMju7Z14TRDFypBy",
                    "display": "Pool#40(Reward)"
                },
                "nominate_count": 1,
                "member_count": 24,
                "total_bonded": "569601109209138883772851",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvef4WYoNonii9mi2gQfVgtvF5zFBZU",
                    "display": "Pool#40(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1616000000000000000000000",
                "issued_staked_enj": "471765994843699234498403",
                "commission": 100000000
            },
            {
                "pool_id": 41,
                "metadata": "Enjin Arena",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7EaH7XhErow77C8nF4xh8X4FyFU16",
                    "display": "Pool#41(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvNybpheBv4GVCyvoikcuNxyt8hX9E9",
                    "display": "Pool#41(Reward)"
                },
                "nominate_count": 1,
                "member_count": 5,
                "total_bonded": "8646153690914662438220",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveidNHkgbFj3JrfUfGAr4oSi1RnXpk",
                    "display": "Pool#41(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "551000000000000000000000",
                "issued_staked_enj": "7334659002406001006580",
                "commission": 100000000
            },
            {
                "pool_id": 42,
                "metadata": "StackShark",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7J98rV12KpGGC9am6aK533XBQnfhh",
                    "display": "Pool#42(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvP3AgSbVhXGpN4tFhc8FksWM494TyN",
                    "display": "Pool#42(Reward)"
                },
                "nominate_count": 1,
                "member_count": 15,
                "total_bonded": "361415486250271251610160",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvenCE2hzNijNTwcve7gCShyAvsKwFR",
                    "display": "Pool#42(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1564000000000000000000000",
                "issued_staked_enj": "300459611980442442240864",
                "commission": 100000000
            },
            {
                "pool_id": 43,
                "metadata": "Cosmic Joke",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7MhzbSJonpbRH72jx5fSwZz6rKwtM",
                    "display": "Pool#43(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvP6jYBYoUzH9X9qhgTdc8n2oyabcAD",
                    "display": "Pool#43(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "1078458437180087500674519",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveqm5mfJABjhd2aNcyBYpcVdrJsS6N",
                    "display": "Pool#43(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1044000000000000000000000",
                "issued_staked_enj": "980277804439358532915428",
                "commission": 100000000
            },
            {
                "pool_id": 44,
                "metadata": "Lost Relics",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7RGrLPcbFpvaN4Uiob1pr6T2HsWp3",
                    "display": "Pool#44(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPAJPvW7GTHUgEo9fK8xWgZGu293Zz",
                    "display": "Pool#44(Reward)"
                },
                "nominate_count": 1,
                "member_count": 18,
                "total_bonded": "153258233998374765702939",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQveuKwWcbwek2n7XpbpguCX26mkQi5P",
                    "display": "Pool#44(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3000000000000000000000000",
                "issued_staked_enj": "125081485006370374025268",
                "commission": 100000000
            },
            {
                "pool_id": 45,
                "metadata": "Life, the Universe and Everything",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7Uqi5LvNiqFjT1vhf6NCkcuwjQnTv",
                    "display": "Pool#45(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPDsFfTR3vHoqKkbeAeJtb5jpTgPnJ",
                    "display": "Pool#45(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "7528016938025955473866",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvextoFZuj7kMwCVGagCFaRYZhBwwxb",
                    "display": "Pool#45(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3425000000000000000000000",
                "issued_staked_enj": "6448538939777188691830",
                "commission": 0
            },
            {
                "pool_id": 46,
                "metadata": "The Knights Kingdom",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7YQZpJEABqatXyNgWbiaf9NsAx662",
                    "display": "Pool#46(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPHS7QQiqPJ8zQi3d29fGVcCjuDYhb",
                    "display": "Pool#46(Reward)"
                },
                "nominate_count": 1,
                "member_count": 13,
                "total_bonded": "12304139087134097923740",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvf2TezXDWakh6HSiZXhbxL52cdVBT1",
                    "display": "Pool#46(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3996000000000000000000000",
                "issued_staked_enj": "10529038424064348198245",
                "commission": 0
            },
            {
                "pool_id": 47,
                "metadata": "Il Dolce Far Niente",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7byRZFXweqv3cvpfN74xZfqncVJGK",
                    "display": "Pool#47(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPLzy9N2crJU9VfVbsf1eQ8ffLkxwc",
                    "display": "Pool#47(Reward)"
                },
                "nominate_count": 1,
                "member_count": 4,
                "total_bonded": "15649838898133421294992",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvf62WjUXJ3m2FNQAYPCxLEbVY52eQc",
                    "display": "Pool#47(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "849000000000000000000000",
                "issued_staked_enj": "13047441495572133487170",
                "commission": 100000000
            },
            {
                "pool_id": 48,
                "metadata": "Liqusenj.io #2",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7fYHJCqj7rFChtGeDcRLUCJi42pAo",
                    "display": "Pool#48(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPQZptKLQKJoJacwajAN2Jf8anJB3V",
                    "display": "Pool#48(Reward)"
                },
                "nominate_count": 1,
                "member_count": 241,
                "total_bonded": "4526777388927071446347263",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvf9bNURq5WmMQTMcXEiJi97xTWZqTb",
                    "display": "Pool#48(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3758000000000000000000000",
                "issued_staked_enj": "3676904015227658928450865",
                "commission": 100000000
            },
            {
                "pool_id": 49,
                "metadata": "Pidgeons Enjin OGs",
                "state": "Destroyed",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7j793A9WaraMnqid57miNimdVa86R",
                    "display": "Pool#49(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPU8gdGeBnK8TfaPZafiQDBbWDqXQc",
                    "display": "Pool#49(Reward)"
                },
                "nominate_count": 0,
                "member_count": 1,
                "total_bonded": "0",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfDAEDP8rymgZYK4W6Df63eRNx7JVs",
                    "display": "Pool#49(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000",
                "issued_staked_enj": "0",
                "commission": 0
            },
            {
                "pool_id": 50,
                "metadata": "Dovecote",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7nfzn7TJ3ruWsoAbvd86HFEYw7EJU",
                    "display": "Pool#50(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPXhYNDwyFKTckXqYSB4n7i4RfNug2",
                    "display": "Pool#50(Reward)"
                },
                "nominate_count": 1,
                "member_count": 22,
                "total_bonded": "107578118179467570571758",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfGj5xLSeSn1idGWUwj1TxAtJPeRXt",
                    "display": "Pool#50(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "204000000000000000000000",
                "issued_staked_enj": "88583561536914447788454",
                "commission": 0
            },
            {
                "pool_id": 51,
                "metadata": "0xf09f929c",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7rErX4m5WsEfxkcan8UUBmhUNegCy",
                    "display": "Pool#51(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPbGQ7BFkiKnmqVHXHgRA2EXM6vBYA",
                    "display": "Pool#51(Reward)"
                },
                "nominate_count": 2,
                "member_count": 16,
                "total_bonded": "464360181657263840088357",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfLHwhHkRunLsiDxToEMqrhMDqByix",
                    "display": "Pool#51(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "405000000000000000000000",
                "issued_staked_enj": "394494059979660274105080",
                "commission": 90000000
            },
            {
                "pool_id": 52,
                "metadata": "Enjin Family",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7uoiG24rysZq3i4Zddpr6JAPpC8JC",
                    "display": "Pool#52(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPeqFr8ZYBL7vvSjW9BmXvkzGYTZHF",
                    "display": "Pool#52(Reward)"
                },
                "nominate_count": 1,
                "member_count": 73,
                "total_bonded": "597986997322076398860736",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfProSF4DNng2oBQSejiDmDp9Gj7Sj",
                    "display": "Pool#52(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "5000000000000000000000000",
                "issued_staked_enj": "486237355725656525777011",
                "commission": 40000000
            },
            {
                "pool_id": 53,
                "metadata": "Liqusenj.io #3",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv7yNZzyNeSstz8fWYV9BDzpdKFjQdq",
                    "display": "Pool#53(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPiQ7b5sKeLT61QBUzh7uqHTByzswS",
                    "display": "Pool#53(Reward)"
                },
                "nominate_count": 1,
                "member_count": 85,
                "total_bonded": "3437703096650848109702324",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfTRfBCMzqo1Bt8rRWF4bfkH4iGaDJ",
                    "display": "Pool#53(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2890000000000000000000000",
                "issued_staked_enj": "2840413457759556687471668",
                "commission": 100000000
            },
            {
                "pool_id": 54,
                "metadata": "0x426c7565204669736820506f77657220506f6f6c20f09f909ff09f909ff09f909f",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv82wRjvgRutE9DcxXLeXbuM6EhGW7U",
                    "display": "Pool#54(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPmxyL3B77LnF6MdTrCUHjov7RYAbh",
                    "display": "Pool#54(Reward)"
                },
                "nominate_count": 1,
                "member_count": 8,
                "total_bonded": "124371794321506068095846",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfWzWv9fnJoLLy6JQMkQyaGjz9owUg",
                    "display": "Pool#54(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1956000000000000000000000",
                "issued_staked_enj": "104061392602013227999781",
                "commission": 0
            },
            {
                "pool_id": 55,
                "metadata": "RapidRidz",
                "state": "Destroyed",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv86WHUszDNtZJJaQWC9syosZA8p8QV",
                    "display": "Pool#55(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPqXq4zUtaM7QBK5ShhpfeLP2s5SKD",
                    "display": "Pool#55(Reward)"
                },
                "nominate_count": 1,
                "member_count": 1,
                "total_bonded": "2230574466396324734",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfaZNf6yZmofW43kPDFmMUoCubMEzd",
                    "display": "Pool#55(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000",
                "issued_staked_enj": "0",
                "commission": 0
            },
            {
                "pool_id": 56,
                "metadata": "StackOrca",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8A59DqHzqttTPXrV3fEMiQ25aMCoY",
                    "display": "Pool#56(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPu6gowng3MSZGGXRZDB3YrqxJco2w",
                    "display": "Pool#56(Reward)"
                },
                "nominate_count": 1,
                "member_count": 1,
                "total_bonded": "2999936172242362957751",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfe8EQ4HMEozf91CN4m7jPKfq2tW9C",
                    "display": "Pool#56(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "726000000000000000000000",
                "issued_staked_enj": "2500000000000000000000",
                "commission": 0
            },
            {
                "pool_id": 57,
                "metadata": "ENJ is King",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8DdzxnbnJuDcUVJTuAajcvV11td6f",
                    "display": "Pool#57(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvPxfYYu6TWMmiMDyQQiXRTPJskA9Jx",
                    "display": "Pool#57(Reward)"
                },
                "nominate_count": 1,
                "member_count": 19,
                "total_bonded": "233527195587092636273836",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfhh691b8hpKpDxeLvGU7Hr8kUS24d",
                    "display": "Pool#57(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "195863829044932965986858",
                "commission": 100000000
            },
            {
                "pool_id": 58,
                "metadata": "Bananas",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8HCrhjuZmuYmZSkSkfw7XSwvTRwas",
                    "display": "Pool#58(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQ2EQHrQEyN6sSBRPGDsoMumoBhiNZ",
                    "display": "Pool#58(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "22552934930601575638843",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfmFwsxtvApeyJv6KmmpVCNbfuy3rJ",
                    "display": "Pool#58(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "19178300056201882821378",
                "commission": 50000000
            },
            {
                "pool_id": 59,
                "metadata": "Substreak",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8LmiShDMEusveQCRcBHVRyQqtyAeg",
                    "display": "Pool#59(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQ5oG2oi2SNS2X8sN7jEBGSEidF3pG",
                    "display": "Pool#59(Reward)"
                },
                "nominate_count": 2,
                "member_count": 130,
                "total_bonded": "1035978481289705532638041",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfppocvChdpz8PsYJdHAs6u4bMWZDA",
                    "display": "Pool#59(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "877095362147905717345195",
                "commission": 100000000
            },
            {
                "pool_id": 60,
                "metadata": "Pepe To The Moon",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8QLaBeX8hvD5jMeQTgdsLVsmLWeWa",
                    "display": "Pool#60(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQ9N7mm1ouNmBc6KLyEaZAxhe4n6iM",
                    "display": "Pool#60(Reward)"
                },
                "nominate_count": 1,
                "member_count": 9,
                "total_bonded": "346533928899641744718455",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvftPfMsWV6qKHUpzHUnXF1RXWo3w1s",
                    "display": "Pool#60(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "907000000000000000000000",
                "issued_staked_enj": "294790180697362132346963",
                "commission": 50000000
            },
            {
                "pool_id": 61,
                "metadata": "Degen #15",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8TuRvbpvAvYEpK6PKBzFF2Lgn3uMP",
                    "display": "Pool#61(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQCvyWiKbNP6Lh3mKpjvw5VAZWKcfZ",
                    "display": "Pool#61(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "20814951871236460445632",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvfwxX6ppGZqeSZnSGLHscuwzSEbGGf",
                    "display": "Pool#61(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2880000000000000000000000",
                "issued_staked_enj": "17915145631498929119015",
                "commission": 100000000
            },
            {
                "pool_id": 62,
                "metadata": "Degen #16",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8XUHfZ8hdvsPuGYNAhLd9YocDbQyV",
                    "display": "Pool#62(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQGVqFfdNqPRVn1DJgFHJz1dUws1FH",
                    "display": "Pool#62(Reward)"
                },
                "nominate_count": 1,
                "member_count": 7,
                "total_bonded": "918899812138640926458312",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvg1XNqn842qybejtFBoDzpUTMg8XVe",
                    "display": "Pool#62(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "841000000000000000000000",
                "issued_staked_enj": "798538827600654022172221",
                "commission": 100000000
            },
            {
                "pool_id": 63,
                "metadata": "Degen Booster",
                "state": "Destroyed",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8b39QWSV6wCYzDzM2Ch145GXf8h9v",
                    "display": "Pool#63(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQL4gzcwAJPkerxfHXkdgtY6QPQNWz",
                    "display": "Pool#63(Reward)"
                },
                "nominate_count": 0,
                "member_count": 1,
                "total_bonded": "0",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvg56EajRqVrJkjhLE3JaNizvH7fikQ",
                    "display": "Pool#63(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2500000000000000000000000",
                "issued_staked_enj": "0",
                "commission": 50000000
            },
            {
                "pool_id": 64,
                "metadata": "0xf09f92a5437269746963616c205374616b65f09f92a5",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8ec19TkGZwXi5BSKsi3NxbjT6fwiR",
                    "display": "Pool#64(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQPdYjaEwmQ5owv7GPFz4o4ZKpwSqJ",
                    "display": "Pool#64(Reward)"
                },
                "nominate_count": 1,
                "member_count": 1,
                "total_bonded": "2867453536993632391118",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvg8f6KgjcxrdupenCtovkdXPCZDFzD",
                    "display": "Pool#64(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "2500000000000000000000",
                "commission": 100000000
            },
            {
                "pool_id": 65,
                "metadata": "Liqusenj.io #4",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8iArtR442wrsA8tJjDPks8CNYDAXx",
                    "display": "Pool#65(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQTCQUXYjEQQy2sZFEmLShb2FGV1GG",
                    "display": "Pool#65(Reward)"
                },
                "nominate_count": 1,
                "member_count": 87,
                "total_bonded": "807162331056319846438670",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgCDx4e3QRry4ucEBkKH8Y3r7zkeDd",
                    "display": "Pool#65(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "677000000000000000000000",
                "issued_staked_enj": "676999737300734537415386",
                "commission": 100000000
            },
            {
                "pool_id": 66,
                "metadata": "0xe2ac9b204f6273696469616e205661756c7420f09f92b0",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8mjidNMqVxC2F6LHaik8mefHykVb6",
                    "display": "Pool#66(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQWmGDUrWhQk87q1E6Ggpc7VAi2LT7",
                    "display": "Pool#66(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "1056882082273443140415882",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgFnoobMBtsJDzZgAbpdWSaK3SHryN",
                    "display": "Pool#66(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "926000000000000000000000",
                "issued_staked_enj": "925999594760849571745186",
                "commission": 100000000
            },
            {
                "pool_id": 67,
                "metadata": "Brave New World",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8qJaNKfcxxXBL3nGSE6WgB8DRHzhT",
                    "display": "Pool#67(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQaL7xSAJAR5HCnTCwn3CWdx69ZTQk",
                    "display": "Pool#67(Reward)"
                },
                "nominate_count": 1,
                "member_count": 1,
                "total_bonded": "2861520512317587928839",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgKMfYYeyMsdP5X89TKytM6mxsqEXL",
                    "display": "Pool#67(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "500000000000000000000000",
                "issued_staked_enj": "2500000000000000000000",
                "commission": 0
            },
            {
                "pool_id": 68,
                "metadata": "Degen Attitude",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8tsS7GyQRxrLR1EFHjStahb8rqCTS",
                    "display": "Pool#68(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQdtyhPU5dRQSHjuBoHPaRAR1b6oh1",
                    "display": "Pool#68(Reward)"
                },
                "nominate_count": 0,
                "member_count": 2,
                "total_bonded": "7500000000000000000000",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgNvXHVxkpsxYAUa8JqLGFdEtKNSFN",
                    "display": "Pool#68(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "7500000000000000000000",
                "commission": 50000000
            },
            {
                "pool_id": 69,
                "metadata": "Degen #17",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv8xSHrEHBtyBVVxgE9EoGVE44JNPNV",
                    "display": "Pool#69(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQhTqSLms6RjbNhMAenjxKgsw2eGmv",
                    "display": "Pool#69(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "22902776602099006729555",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgSVP2TGYHtHhFS27ALgeA9hokuqrc",
                    "display": "Pool#69(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "774000000000000000000000",
                "issued_staked_enj": "20088713379306175786932",
                "commission": 100000000
            },
            {
                "pool_id": 70,
                "metadata": "Degen #1561",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9219bBayMyWeav8Czk9ePkWyjv1ev",
                    "display": "Pool#70(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQm2hBJ5eZS4kTeo9WJ6LEDLrUBPQb",
                    "display": "Pool#70(Reward)"
                },
                "nominate_count": 0,
                "member_count": 1,
                "total_bonded": "2500000000000000000000",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgW4EmQaKktcrLPU61r324gAjCTGjD",
                    "display": "Pool#70(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1979000000000000000000000",
                "issued_staked_enj": "2500000000000000000000",
                "commission": 50000000
            },
            {
                "pool_id": 71,
                "metadata": "Stake And Bake",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv95a1L8tkpyqofsaBrFW2JGyuBT663",
                    "display": "Pool#71(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQpbYvFPS2SPuYcF8MoSi8jomuiwAn",
                    "display": "Pool#71(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "1288882244122159110665759",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgZd6WMt7Dtx1RLv4sMPPyCdedzZoN",
                    "display": "Pool#71(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1300000000000000000000000",
                "issued_staked_enj": "851989997132272764622546",
                "commission": 0
            },
            {
                "pool_id": 72,
                "metadata": "ENJ Booster",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv998s56CYHzAxkq2AhkrQCoSpczXDQ",
                    "display": "Pool#72(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQtAQfChDVSj4dZh7DJo63GGhMG7AU",
                    "display": "Pool#72(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "2836015138925308407839",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgdBxFKBtguHAWJN3irjmsj6a5XdTk",
                    "display": "Pool#72(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "4949000000000000000000000",
                "issued_staked_enj": "2522331531246339970916",
                "commission": 50000000
            },
            {
                "pool_id": 73,
                "metadata": "Etherscape #3",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9Chip3WKkzW7qnU9ZGCn7Kuk4XtT7",
                    "display": "Pool#73(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvQwjGQ9zzxT4DiX964p9TwnjcnoTut",
                    "display": "Pool#73(Reward)"
                },
                "nominate_count": 1,
                "member_count": 43,
                "total_bonded": "1057935426314650467100997",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvggkozGVg9ucKbFp2aN69nFZVX54PF",
                    "display": "Pool#73(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2970000000000000000000000",
                "issued_staked_enj": "932018709881972674296135",
                "commission": 0
            },
            {
                "pool_id": 74,
                "metadata": "Halo",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9GGaYzp7DzqGvjv8QmZA1rNfW5Dz9",
                    "display": "Pool#74(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvR1J897JnRTPNoUb4vKVqrKCYELuAw",
                    "display": "Pool#74(Reward)"
                },
                "nominate_count": 1,
                "member_count": 1,
                "total_bonded": "2737377360802224047708",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgkKfjDoTcuwUgDG1RsSXgn2Qxcajh",
                    "display": "Pool#74(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1606000000000000000000000",
                "issued_staked_enj": "2500000000000000000000",
                "commission": 0
            },
            {
                "pool_id": 75,
                "metadata": "RapidRidz",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9KqSHx7th1AS1hN7GGuXvNqawcTQA",
                    "display": "Pool#75(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvR4ryt4cZtTiXtS33mprDkqfTftARp",
                    "display": "Pool#75(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "3836945277927403645310",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgotXUB7F5vGdmAhzHNnubJVLQ9mwn",
                    "display": "Pool#75(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "220000000000000000000000",
                "issued_staked_enj": "3500000000000000000000",
                "commission": 0
            },
            {
                "pool_id": 76,
                "metadata": "Screw loose",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9PQJ2uRgA1Vb6ep67nFupuJWP9vtS",
                    "display": "Pool#76(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvR8Rqd1vMMU3gyPV2dLCbfN8P7RKbG",
                    "display": "Pool#76(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "10410687826865802437863",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgsTPD8R2Yvbnr89y8t9HVpxFqgvwj",
                    "display": "Pool#76(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "9490057309528713272896",
                "commission": 100000000
            },
            {
                "pool_id": 77,
                "metadata": "Bloodsong Stakeforge",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9Sy9mrjTd1pkBcG4yHcHjRmRph3Ec",
                    "display": "Pool#77(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRBzhMyE8pUNr4Lw1UqYyZtbJYxn2R",
                    "display": "Pool#77(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "1320893993194662366671971",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgw2Ex5ip1vvww5bwzPVfQMRBHEULe",
                    "display": "Pool#77(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3698000000000000000000000",
                "issued_staked_enj": "1204394710805099557369165",
                "commission": 100000000
            },
            {
                "pool_id": 78,
                "metadata": "Liqusenj.io #5",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9WY1Wp3F629uGZi3pnxfdxEMGEcUh",
                    "display": "Pool#78(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRFZZ6vXvHUi19JNzLLuMUR4DzWDFM",
                    "display": "Pool#78(Reward)"
                },
                "nominate_count": 1,
                "member_count": 52,
                "total_bonded": "2477956494347385465737666",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvgzb6h32bUwG7233vqtr3Jst6imopr",
                    "display": "Pool#78(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "5500000000000000000000000",
                "issued_staked_enj": "2206171697946969628721658",
                "commission": 100000000
            },
            {
                "pool_id": 79,
                "metadata": "YKIYK Degen Pool",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9a6sFmM2Z2V4MXA2gJK3YUhGhmrua",
                    "display": "Pool#79(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRK8QqsqhkV3AEFpyBrFjNwX9S3ZPV",
                    "display": "Pool#79(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "15575125183222562829311",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvh49xRzLNwwbG6zVuhQCRDQM2AK44e",
                    "display": "Pool#79(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1647000000000000000000000",
                "issued_staked_enj": "14250842366958536997883",
                "commission": 77700000
            },
            {
                "pool_id": 80,
                "metadata": "Valhalla",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9dfiziep22pDSUc1XofRT1AC9K6Mb",
                    "display": "Pool#80(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRNhGaq9VDVNKKDGx3Mc7HTz4sabec",
                    "display": "Pool#80(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "9618127798057343657987",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvh7ipAweAQwvRBwwtYuYo7vowbrLaZ",
                    "display": "Pool#80(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "289000000000000000000000",
                "issued_staked_enj": "8826828886111301821701",
                "commission": 100000000
            },
            {
                "pool_id": 81,
                "metadata": "Golden tooth",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9hEajfxbV39NXS3zPK1oMXd7arZae",
                    "display": "Pool#81(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRSG8KnTGgVhUQAivtrxVBzSzK7wYK",
                    "display": "Pool#81(Reward)"
                },
                "nominate_count": 1,
                "member_count": 10,
                "total_bonded": "77173801822226470020064",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhBHfutwwsxFaGuPsQQuB2TGs3Pifn",
                    "display": "Pool#81(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1957000000000000000000000",
                "issued_staked_enj": "69948932780432730157246",
                "commission": 50000000
            },
            {
                "pool_id": 82,
                "metadata": "Degen Pool",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9koSUdGNx3UXcPVyEpNBG4632PwAu",
                    "display": "Pool#82(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRVpz4jm49W2dV8AukNJs6WuukfHci",
                    "display": "Pool#82(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "7440995071579728435663",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhErXerFjLxajMrqrFvFYvyjnUw2Ux",
                    "display": "Pool#82(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2374000000000000000000000",
                "issued_staked_enj": "6854202475568401581362",
                "commission": 100000000
            },
            {
                "pool_id": 83,
                "metadata": "Liqusenj.io #6",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9pNJDaaAR3oghLwx6KiZAaYxTwF2q",
                    "display": "Pool#83(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRZPqoh4qcWMna5ctbsfF13NqCCpie",
                    "display": "Pool#83(Reward)"
                },
                "nominate_count": 1,
                "member_count": 23,
                "total_bonded": "1765024010964224560406154",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhJRPPoZWoxutSpHq7RbvqWChvUVM8",
                    "display": "Pool#83(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2800000000000000000000000",
                "issued_staked_enj": "1635274107585059185639240",
                "commission": 100000000
            },
            {
                "pool_id": 84,
                "metadata": "A Pidgeons Tale",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9sw9xXswt48qnJPvwq4w571suUSyx",
                    "display": "Pool#84(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRcxhYeNd5Wgwf34sTP1cuZqkdk5Q5",
                    "display": "Pool#84(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "1151382945405366391579029",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhMzF8ksJGyF3XmjoxvxJk2fdN1dP6",
                    "display": "Pool#84(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "2412000000000000000000000",
                "issued_staked_enj": "1081160000000000000000000",
                "commission": 30000000
            },
            {
                "pool_id": 85,
                "metadata": "Degen  #18",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQv9wW1hVBjM4TzsFquoLRJydUoM1opD",
                    "display": "Pool#85(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRgXZHbgQYX26jzWrJtMzp6Jg5HYVQ",
                    "display": "Pool#85(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "33012883927691890991796",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhRZ6siB5jyaCcjBnpSJgeZ8YoZA2f",
                    "display": "Pool#85(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "31267301461597312402993",
                "commission": 100000000
            },
            {
                "pool_id": 86,
                "metadata": "0x546865204a6f6b6520536861636b20f09f98bc",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvA14sSSVWp4o9xDHteqmgt9winYzfC",
                    "display": "Pool#86(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRk6R2YzC1XMFpwxqAPiNicmbWpfFP",
                    "display": "Pool#86(Reward)"
                },
                "nominate_count": 1,
                "member_count": 5,
                "total_bonded": "46735967535067694880609",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhV7xcfUsCyuMhgdmfwf4Z5bUF6PBD",
                    "display": "Pool#86(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1384000000000000000000000",
                "issued_staked_enj": "44015498650073949416233",
                "commission": 40000000
            },
            {
                "pool_id": 87,
                "metadata": "0xf09f9181efb88ff09faba6f09f9181efb88f205468697273742054726170205472656173757279e284a220e29ca8",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvA4djBPoJH58K3AjsWM84ngQeE6U2u",
                    "display": "Pool#87(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRofGmWHyUXgQuuQp1u4kd9EWxNBKF",
                    "display": "Pool#87(Reward)"
                },
                "nominate_count": 1,
                "member_count": 5,
                "total_bonded": "3203916954682450074208",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhYgpMcnefzEWne5kXT1STc4PgdkBY",
                    "display": "Pool#87(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1346000000000000000000000",
                "issued_staked_enj": "3009468587577786607597",
                "commission": 50000000
            },
            {
                "pool_id": 88,
                "metadata": "crypto bros",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvA8CavM75k5TU88BrMrUShCsZfdoDe",
                    "display": "Pool#88(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRsE8WTbkwY1ZzrrnsQR8XfhSPuG1d",
                    "display": "Pool#88(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "164648414652016071563093",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhcFg6a6S8zZfsbXjNxMpN8XK8Au1R",
                    "display": "Pool#88(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1302000000000000000000000",
                "issued_staked_enj": "155471458442274135913061",
                "commission": 50000000
            },
            {
                "pool_id": 89,
                "metadata": "Enjin Pool",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvABmSfJQsD5ndD5dqDMppbjLV7Aw4y",
                    "display": "Pool#89(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRvnzFQuYQYLj5pJmiumWSCAMqSndj",
                    "display": "Pool#89(Reward)"
                },
                "nominate_count": 1,
                "member_count": 1,
                "total_bonded": "2626144797743338821178",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhfpXqXQDbztpxYyiETiCGezEZiHKL",
                    "display": "Pool#89(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "2500000000000000000000",
                "commission": 50000000
            },
            {
                "pool_id": 90,
                "metadata": "0x4f4720486561727420e29da4efb88f20",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAFLJQFieg67nJ35p4sBCWFoQYiGCH",
                    "display": "Pool#90(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvRzMqzNDKsYftAmkkaR7tLidHGz8sj",
                    "display": "Pool#90(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "41960071703453000356633",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhjPPaUi151Dz3WRh5y4aBBTA1FVbX",
                    "display": "Pool#90(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "576000000000000000000000",
                "issued_staked_enj": "39924703599755218654065",
                "commission": 30000000
            },
            {
                "pool_id": 91,
                "metadata": "The Multiverse Brotherhood",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAJuA9D2S96SwNzXnvNXaQnGKzFgma",
                    "display": "Pool#91(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvS3vhjKX7LZ13FjCjRvUGFF6CiXSJv",
                    "display": "Pool#91(Reward)"
                },
                "nominate_count": 1,
                "member_count": 11,
                "total_bonded": "63340660102940895517415",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhnxFKS1nY1Z98TsfwUQx5hv5So9F1",
                    "display": "Pool#91(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1290000000000000000000000",
                "issued_staked_enj": "61762922836165887113344",
                "commission": 100000000
            },
            {
                "pool_id": 92,
                "metadata": "Liqusenj.io #7",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvANU1tALDc6n6TwymmssxKJjFRo3jK",
                    "display": "Pool#92(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvS7VZUGptoZLCLgeiHRpe9mZ8A4mz2",
                    "display": "Pool#92(Reward)"
                },
                "nominate_count": 1,
                "member_count": 27,
                "total_bonded": "93476900408883600640592",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhrX74PKa11tJDRKenymKzENztLJ78",
                    "display": "Pool#92(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "1038000000000000000000000",
                "issued_staked_enj": "91050781475275330878622",
                "commission": 100000000
            },
            {
                "pool_id": 93,
                "metadata": "0x536f6f6ee284a2efb88f",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAS2sd7e1577FYuRkdPELDqCAsLHCv",
                    "display": "Pool#93(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvSB4RDE8gGZfMRe6h8wB24J23bbzHc",
                    "display": "Pool#93(Reward)"
                },
                "nominate_count": 1,
                "member_count": 4,
                "total_bonded": "9254878510528518877038",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhv5xoLdMU2DTJNmdeV7htkqvKsm9t",
                    "display": "Pool#93(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "9087693113533117071447",
                "commission": 100000000
            },
            {
                "pool_id": 94,
                "metadata": "0x4146554552412120f09f97bd56495641204c41204c4942455254414420434152414a4f21",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAVbjN4wnY7SQdrsjUtai8Mf6Jsdp3",
                    "display": "Pool#94(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvSEdGxBSTjZzWWbYfzSXPxpUy39RxL",
                    "display": "Pool#94(Reward)"
                },
                "nominate_count": 0,
                "member_count": 2,
                "total_bonded": "2888598125193703619860",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvhyepYHw8w2YcPLDcVzU5oHJqmQyxo",
                    "display": "Pool#94(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "3088000000000000000000000",
                "issued_staked_enj": "2888713673740653245989",
                "commission": 0
            },
            {
                "pool_id": 95,
                "metadata": "The Singularity ",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAZAb72Fa17mZipKiLPw62t81kR4fz",
                    "display": "Pool#95(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvSJC8h8kFCaKfbYzeqwsmsLwtUgbzL",
                    "display": "Pool#95(Reward)"
                },
                "nominate_count": 1,
                "member_count": 3,
                "total_bonded": "13738347063005191071771",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvi3DgHFEvQ2smUHfbMVpThommCxL2K",
                    "display": "Pool#95(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "13490017222589235507203",
                "commission": 20000000
            },
            {
                "pool_id": 96,
                "metadata": "Etherscape #4",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAcjSqyZMU86iommhBuHTwQawBxFsv",
                    "display": "Pool#96(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvSMkzS642faepgWSdhTE9msQovE6C9",
                    "display": "Pool#96(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "5528984835035060439430",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvi6nY2CYhs3CvZF7aD1AqcLEgeVYNh",
                    "display": "Pool#96(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "208000000000000000000000",
                "issued_staked_enj": "5491099168783746711613",
                "commission": 50000000
            },
            {
                "pool_id": 97,
                "metadata": "Pool Party",
                "state": "Open",
                "pool_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvAgJJavs8w8RstjDg3Qdqqw3rdVYrf",
                    "display": "Pool#97(Stash)"
                },
                "pool_reward_account": {
                    "address": "enD9wdMEaQa3LR6AUWQvSRKrB3Mp8ayymTtcYxaXgPsjMmKQS",
                    "display": "Pool#97(Reward)"
                },
                "nominate_count": 1,
                "member_count": 2,
                "total_bonded": "20459696764893030461986",
                "claimable": "0",
                "bounis_account": {
                    "address": "enD9wdMEaQa3LR6AUWQviAMPm9rVL3Y5eCZZ4WXDWrhc633Ay",
                    "display": "Pool#97(Bonus)"
                },
                "bounis": "0",
                "max_capacity": "200000000000000000000000",
                "issued_staked_enj": "20431294378812662320256",
                "commission": 100000000
            }
        ]
    }
}
```

## Step 2 — Get Each Pool's Nominated Validators

Use the pool's stash address from Step 1:

```
POST https://enjin.api.subscan.io/api/scan/staking/voted
```

### Request Body
```json
{
    "address": "enD9wdMEaQa3LR6AUWQv4iM7kS86maPgbzmbFKZCzz2Uv7758"
}
```

## Response Body

```json
{
    "code": 0,
    "message": "Success",
    "generated_at": 1772261398,
    "data": {
        "list": [
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
            },
            {
                "rank_validator": 16,
                "bonded_nominators": "16574524621338499059433860",
                "bonded_owner": "183109869918831885025284",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enEbAAWuR8L73eyr9WtFWtZYbw3UhfPcdNBDiQc9YWy31V784"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "5095604287644624596282076",
                "active": true
            },
            {
                "rank_validator": 17,
                "bonded_nominators": "15895820347157940954683904",
                "bonded_owner": "861229548226721796031332",
                "count_nominators": 1,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enEm2HMCCrNGhDUbtZ9QcZmfThL9jHeiA5JR4ZVR2Hi9kqUni"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "15895820347157940954683904",
                "active": true
            },
            {
                "rank_validator": 18,
                "bonded_nominators": "15898289847624380079207252",
                "bonded_owner": "860228226480577690564344",
                "count_nominators": 3,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enF4pssFtqA6dQHMqWcnFzVyzZ5AbRXX3NJA3eigxWL8YQUKK"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "6540788714493799652423112",
                "active": true
            },
            {
                "rank_validator": 21,
                "bonded_nominators": "16573887199131197220479700",
                "bonded_owner": "183686291406178843188672",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enFw32hdoxiEfhnenLqkLg3t2ec5f4ixVzmRW4VVQCbkTc194"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "16565245240531220982632700",
                "active": true
            },
            {
                "rank_validator": 22,
                "bonded_nominators": "15881701731222021947184096",
                "bonded_owner": "881519876306396399348172",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enFzJ3vs1nxjr4rvzv38rMzxrS88srTffU5T2FcpdgsLEirTy"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "15784652314323389010866364",
                "active": true
            },
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
                "rank_validator": 23,
                "bonded_nominators": "15885075731158986892784496",
                "bonded_owner": "872800689304810417186044",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enG2tPZeAkKCNSxgXnWNDhGf5j83GZboj41ypUENcGZCNDheN",
                    "parent": {
                        "address": "enGFYWf4YUhX4m6tVv8bMa3udnDc1jx292BSd7Cbhm58TvsQm",
                        "display": "Enjin",
                        "sub_symbol": "US1",
                        "identity": true
                    }
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 9,
                "bonded_nominators": "15882330070014711658998120",
                "bonded_owner": "874876975734484535976396",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enCMbpGcNKfaY7bRfSyZAVdSGe48MnihCG9n4BvaCUtATxLzG",
                    "parent": {
                        "address": "enGFYWf4YUhX4m6tVv8bMa3udnDc1jx292BSd7Cbhm58TvsQm",
                        "display": "Enjin",
                        "sub_symbol": "US2",
                        "identity": true
                    }
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 2,
                "bonded_nominators": "15898144480715078558087940",
                "bonded_owner": "873410151356631149150376",
                "count_nominators": 1,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enB3aj9qMZkHtJy2NwRrx8UvZn83qrfaibpNFgpwt7P3B5yWa"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 0,
                "bonded_nominators": "0",
                "bonded_owner": "0",
                "count_nominators": 0,
                "validator_prefs_value": 0,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enGJZezJA9vF4yfSbPYzo1u5NyJxn7HdCvixcfaBdrBkF7gWo"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 5,
                "bonded_nominators": "15870858222591529396539660",
                "bonded_owner": "887087779726630569020064",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enBRFocgo4aPAVtny93ZLaTPX9JpbxrSeBt29uXdLy3AcG8Dx",
                    "parent": {
                        "address": "enGFYWf4YUhX4m6tVv8bMa3udnDc1jx292BSd7Cbhm58TvsQm",
                        "display": "Enjin",
                        "sub_symbol": "EU1",
                        "identity": true
                    }
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 10,
                "bonded_nominators": "15875679265703229831705648",
                "bonded_owner": "882204340227906055780872",
                "count_nominators": 3,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enCTe5RMrn159cF187zEGn5VrzvYM19kwrQFrzkzC7fR2Txrp"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 12,
                "bonded_nominators": "15897974925369874668666300",
                "bonded_owner": "860986581920564221699740",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enCbYndxGeoXWSAwAxL23bcVVu5zcjenmDjTiaqpyYLr8ux2s",
                    "parent": {
                        "address": "enGFYWf4YUhX4m6tVv8bMa3udnDc1jx292BSd7Cbhm58TvsQm",
                        "display": "Enjin",
                        "sub_symbol": "AP1",
                        "identity": true
                    }
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 7,
                "bonded_nominators": "16587228276936585122256252",
                "bonded_owner": "182947994753669836818444",
                "count_nominators": 2,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enCC76sMpXRKERr7xJtHA3NLWeLR8gF1z7ZUgs6rH6fxPJC8v"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            },
            {
                "rank_validator": 1,
                "bonded_nominators": "16574893383455070585089760",
                "bonded_owner": "182578127855624081595684",
                "count_nominators": 1,
                "validator_prefs_value": 50000000,
                "latest_mining": 0,
                "reward_point": 0,
                "session_key": null,
                "stash_account_display": {
                    "address": "enAxDeawNAicPNEgBu2hKaWKUEjhQTQcsLTccoC2ABozPHH2n"
                },
                "controller_account_display": null,
                "grandpa_vote": 0,
                "bonded_total": "0",
                "status": "",
                "blocked": false,
                "bonded": "0",
                "active": false
            }
        ]
    }
}
```

## Step 3 — Map the Target Era to a Block Range
Assume that the eras has already been established:
- Input from the user: 3 eras
- Current era: 984
- Eras to scan: 982, 983, 984


## Step 4 — Confirm the Pool Received a Staking Reward in That Era

This is the primary confirmation call. Use the **pool's stash address** (not a member's address):

```
POST https://enjin.api.subscan.io/api/v2/scan/account/reward_slash
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
    "generated_at": 1772263913,
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
