import http.client
import json
import csv
import time

# conf
HEADERS = {
    'x-api-key': "API_KEY",
    'Content-Type': 'application/json'
}

ROW_PER_PAGE = 100
MAX_RETRIES = 3
RETRY_DELAY = 5

EXTRINSIC_PARAMS_ENDPOINT = "/api/scan/extrinsic/params"
EVENT_PARAMS_ENDPOINT = "/api/scan/extrinsic/params"
EVENTS_ENDPOINT = "/api/v2/scan/events"
EXTRINSIC_ENDPOINT = "/api/v2/scan/extrinsics"

API_HOST = "enjin.api.subscan.io"
CSV_FILENAME = "enjin_extrinsic.csv"
API_ENDPOINT = "/api/v2/scan/extrinsics"
AFTER_ID_FIELD = "id"
RESPONSE_LIST_FIELD = "extrinsics"
PAYLOAD_TEMPLATE = {
    "row": 100,
    "signed": "signed",
    "module_call": [{"module":"nominationpools","call":""}],
    "address": "YOUR_WALLET_ADDRESS_HERE"
} 


def get_api_data(after_id, page=0):
    payload = PAYLOAD_TEMPLATE.copy()
    if type(after_id) is int and after_id > 0:
        payload["after_id"] = after_id if AFTER_ID_FIELD != "transfer_id" else [after_id]
    if type(after_id) is str and after_id != "":
        payload["after_id"] = after_id
    
    payload["page"] = page

    for attempt in range(MAX_RETRIES):
        conn = None
        try:
            conn = http.client.HTTPSConnection(API_HOST)
            conn.request("POST", API_ENDPOINT, json.dumps(payload), HEADERS)
            response = conn.getresponse()

            if response.status == 429:
                print(f"rate limit，wait {RETRY_DELAY} seconds...")
                time.sleep(RETRY_DELAY)
                continue

            if response.status != 200:
                raise Exception(f"HTTP error {response.status}: {response.reason}")

            data = json.loads(response.read().decode())
            if data.get('code') != 0:
                raise Exception(f"API error: {data.get('message', 'unknown error')}")

            list_data = data.get('data', {}).get(RESPONSE_LIST_FIELD, []) if RESPONSE_LIST_FIELD else data.get('data',
                                                                                                               [])

            if API_ENDPOINT in [EVENTS_ENDPOINT, EXTRINSIC_ENDPOINT]:
                try:
                    params_index = []
                    for item in list_data:
                        index_key = 'event_index' if API_ENDPOINT == EVENTS_ENDPOINT else 'extrinsic_index'
                        if index_key in item:
                            params_index.append(item[index_key])
                        else:
                            params_index = []
                            break

                    if params_index:
                        params_endpoint = EVENT_PARAMS_ENDPOINT if API_ENDPOINT == EVENTS_ENDPOINT else EXTRINSIC_PARAMS_ENDPOINT
                        params_payload = {
                            "event_index" if API_ENDPOINT == EVENTS_ENDPOINT else "extrinsic_index": params_index}
                        if params_endpoint == "":
                            return list_data
                        for param_attempt in range(MAX_RETRIES):
                            try:
                                conn.request("POST", params_endpoint, json.dumps(params_payload), HEADERS)
                                param_response = conn.getresponse()

                                if param_response.status == 429:
                                    print(f"rate limit，wait{RETRY_DELAY}seconds...")
                                    time.sleep(RETRY_DELAY)
                                    continue

                                if param_response.status != 200:
                                    raise Exception(f"http error {param_response.status}")

                                param_data = json.loads(param_response.read().decode())
                                if param_data.get('code') != 0:
                                    raise Exception(f"http error: {param_data.get('message', 'unknown error')}")

                                param_list = param_data.get('data', [])
                                param_dict = {item[
                                                  'event_index' if API_ENDPOINT == EVENTS_ENDPOINT else 'extrinsic_index']: item.get(
                                    'params', []) for item in param_list}

                                for i, item in enumerate(list_data):
                                    index = item.get(
                                        'event_index' if API_ENDPOINT == EVENTS_ENDPOINT else 'extrinsic_index')
                                    if index in param_dict:
                                        list_data[i]['params'] = param_dict[index]
                                break

                            except Exception as param_e:
                                print(f"failed（retry {param_attempt + 1}/{MAX_RETRIES}）: {str(param_e)}")
                                time.sleep(RETRY_DELAY)

                except Exception as merge_error:
                    print(f"something wrong when merge params: {str(merge_error)}")

            return list_data

        except Exception as e:
            print(f"failed（retry {attempt + 1}/{MAX_RETRIES}）: {str(e)}")
            if attempt == MAX_RETRIES - 1:
                return None
            time.sleep(RETRY_DELAY)
        finally:
            if conn:
                conn.close()
    return None


def main():
    after_id = 0
    page = 0
    with open(CSV_FILENAME, 'w', newline='', encoding='utf-8') as csvfile:
        writer = None
        total_count = 0

        while True:
            records = get_api_data(after_id, page)

            if not records:
                print("no more records")
                break

            if not writer:
                fieldnames = records[0].keys()
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames, extrasaction='ignore')
                writer.writeheader()

            writer.writerows(records)
            current_count = len(records)
            total_count += current_count
            print(f"page get {current_count} records，sum {total_count} records")

            if current_count < ROW_PER_PAGE:
                break

            # check AFTER_ID_FIELD exist
            if AFTER_ID_FIELD not in records[-1]:
                page += 1
            else:
                after_id = records[-1][AFTER_ID_FIELD]

            time.sleep(1)


if __name__ == "__main__":
    main()
    print("success download")
