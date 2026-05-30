#!/usr/bin/env python3
"""
Derive EVM private keys from a BIP39 seed phrase.
Derivation path: m/44'/60'/0'/0/<index>  (standard Ethereum/Monad)
"""

import getpass
import argparse
from eth_account import Account

Account.enable_unaudited_hdwallet_features()


def derive_accounts(mnemonic: str, count: int = 1, offset: int = 0) -> list[dict]:
    accounts = []
    for i in range(offset, offset + count):
        path = f"m/44'/60'/0'/0/{i}"
        acct = Account.from_mnemonic(mnemonic, account_path=path)
        accounts.append({
            "index": i,
            "path": path,
            "address": acct.address,
            "private_key": acct.key.hex(),
        })
    return accounts


def main():
    parser = argparse.ArgumentParser(description="Derive EVM keys from seed phrase")
    parser.add_argument("-n", "--count", type=int, default=1, help="Number of accounts to derive (default: 1)")
    parser.add_argument("--offset", type=int, default=0, help="Starting index (default: 0)")
    parser.add_argument("--show-key", action="store_true", help="Print private keys to stdout (careful!)")
    args = parser.parse_args()

    mnemonic = getpass.getpass("Seed phrase: ").strip()

    if not mnemonic:
        print("Error: seed phrase cannot be empty.")
        raise SystemExit(1)

    try:
        accounts = derive_accounts(mnemonic, count=args.count, offset=args.offset)
    except Exception as e:
        print(f"Error deriving accounts: {e}")
        raise SystemExit(1)

    print()
    for acct in accounts:
        print(f"Index {acct['index']}  ({acct['path']})")
        print(f"  Address:     {acct['address']}")
        if args.show_key:
            print(f"  Private key: {acct['private_key']}")
        else:
            print(f"  Private key: {acct['private_key'][:6]}...{acct['private_key'][-4:]}  (use --show-key to reveal)")
        print()


if __name__ == "__main__":
    main()
