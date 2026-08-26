import { describe, it, expect } from 'vitest'
import { mergeTokenDetails, toTokenMetadata } from './[...proxy].js'

// Regression coverage for the ENJ Infusion Checker token-details merge: each
// field is resolved by whichever upstream (on-chain typeData/eth_call, Etherscan
// contract lookup, OpenSea) actually owns it, walking sources in priority order
// and skipping empty results. See mergeTokenDetails' own comment in
// api/[...proxy].js for the full per-field-authority table and rationale.
describe('mergeTokenDetails', () => {
  it('does not let an empty OpenSea creator overwrite a resolved Etherscan creator', () => {
    // This is the exact regression found live: proxyEnjTokenDetails used to spread
    // ...openSeaMetadata after the explicit `creator` key, so OpenSea's real-world
    // creator: '' silently wiped out the Etherscan contractCreator fetched moments
    // earlier. firstNonEmpty must skip the empty OpenSea value instead.
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      contractCreator: '0x5df2e003cecb0ebf69cbd8f7fbb6f44f690331f2',
      openSeaMetadata: { creator: '' },
    })

    expect(result.creator).toBe('0x5df2e003cecb0ebf69cbd8f7fbb6f44f690331f2')
  })

  it('prefers on-chain balanceOf quantity over a differing OpenSea owners[] quantity', () => {
    // Values are deliberately different (not just both "1"), or this test would
    // pass even with the priority order reversed.
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      onChainQuantity: '3',
      openSeaMetadata: { quantity: '999' },
    })

    expect(result.quantity).toBe('3')
  })

  it('falls back to OpenSea quantity when the on-chain read is empty', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      onChainQuantity: '',
      openSeaMetadata: { quantity: '7' },
    })

    expect(result.quantity).toBe('7')
  })

  it('prefers a differing on-chain typeData name over OpenSea and reports the conflict', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      typeDataName: 'Liberty',
      openSeaMetadata: { name: 'Something Else Entirely' },
    })

    expect(result.name).toBe('Liberty')
    expect(result.nameSource).toBe('typedata')
    expect(result.nameConflict).toEqual({ typeData: 'Liberty', openSea: 'Something Else Entirely' })
  })

  it('does not report a conflict when typeData and OpenSea agree', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      typeDataName: 'HAPPY NEW YEAR 2020',
      openSeaMetadata: { name: 'HAPPY NEW YEAR 2020' },
    })

    expect(result.nameConflict).toBeNull()
  })

  it('falls back to OpenSea name when typeData is empty', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      typeDataName: '',
      openSeaMetadata: { name: 'HAPPY NEW YEAR 2020' },
    })

    expect(result.name).toBe('HAPPY NEW YEAR 2020')
    expect(result.nameSource).toBe('opensea')
    expect(result.nameConflict).toBeNull()
  })

  it('falls back to OpenSea name when the typeData call failed (no value at all)', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      openSeaMetadata: { name: 'HAPPY NEW YEAR 2020' },
    })

    expect(result.name).toBe('HAPPY NEW YEAR 2020')
    expect(result.nameSource).toBe('opensea')
  })

  it('resolves to an empty name with an empty source when every source is empty', () => {
    const result = mergeTokenDetails({ tokenId: '1', owner: '0xowner' })

    expect(result.name).toBe('')
    expect(result.nameSource).toBe('')
    expect(result.nameConflict).toBeNull()
  })

  it('does not let an empty OpenSea properties array shadow populated tokenURI attributes', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      openSeaMetadata: { properties: [] },
      uriMetadata: { properties: [{ trait: 'type', value: 'x', rarity: '' }] },
    })

    expect(result.properties).toEqual([{ trait: 'type', value: 'x', rarity: '' }])
  })

  it('defaults properties to an empty array, not an empty string, when nothing resolves', () => {
    const result = mergeTokenDetails({ tokenId: '1', owner: '0xowner' })

    expect(result.properties).toEqual([])
  })

  it('image/description prefer OpenSea over the tokenURI JSON', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      openSeaMetadata: { previewImage: 'https://opensea/img.png', description: 'from opensea' },
      uriMetadata: { previewImage: 'https://uri/img.png', description: 'from uri' },
    })

    expect(result.previewImage).toBe('https://opensea/img.png')
    expect(result.description).toBe('from opensea')
  })

  it('falls back to the tokenURI JSON for image/description when OpenSea has neither', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      openSeaMetadata: {},
      uriMetadata: { previewImage: 'https://uri/img.png', description: 'from uri' },
    })

    expect(result.previewImage).toBe('https://uri/img.png')
    expect(result.description).toBe('from uri')
  })

  it('prefers the on-chain tokenUri over OpenSea metadata_url', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      onChainUri: 'https://onchain/meta.json',
      openSeaMetadata: { tokenUri: 'https://opensea/meta.json' },
    })

    expect(result.tokenUri).toBe('https://onchain/meta.json')
  })

  it('falls back to OpenSea metadata_url when the on-chain uri() is empty', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      onChainUri: '',
      openSeaMetadata: { tokenUri: 'https://opensea/meta.json' },
    })

    expect(result.tokenUri).toBe('https://opensea/meta.json')
  })

  it('clears metadataError when a name resolved even though OpenSea and the URI both failed', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      typeDataName: 'Liberty',
      openSeaMetadata: { metadataError: 'OpenSea API returned HTTP 429.' },
      uriMetadata: { metadataError: 'metadata URI returned HTTP 404' },
    })

    expect(result.metadataError).toBeNull()
  })

  it('clears metadataError when the on-chain uri() is empty but OpenSea succeeded', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      onChainUri: '',
      openSeaMetadata: { name: 'HAPPY NEW YEAR 2020', previewImage: 'https://img' },
    })

    expect(result.metadataError).toBeNull()
  })

  it('surfaces metadataError when name and previewImage both fail to resolve from any source', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      openSeaMetadata: { metadataError: 'OpenSea API returned HTTP 429.' },
      uriMetadata: { metadataError: 'metadata URI returned HTTP 404' },
    })

    expect(result.metadataError).toBe('OpenSea API returned HTTP 429.')
  })

  it('always pins tokenStandard to the hyphenated literal, ignoring OpenSea\'s unhyphenated value', () => {
    const result = mergeTokenDetails({
      tokenId: '1',
      owner: '0xowner',
      openSeaMetadata: { tokenStandard: 'ERC1155' },
    })

    expect(result.tokenStandard).toBe('ERC-1155')
  })
})

describe('toTokenMetadata', () => {
  it('does not fabricate a display name from the contract-level Etherscan tokenName/tokenSymbol', () => {
    // Etherscan's token1155tx endpoint reports the *contract's* name/symbol
    // (e.g. "Enjin") identically for every token on the contract, not real
    // per-token metadata. The old behaviour synthesized "Enjin #<id>" from this,
    // which rendered as if it were the token's real name.
    const { metadata } = toTokenMetadata('0xowner', '123', 'Enjin', '', 1n)

    expect(metadata.name).toBe('')
    expect(metadata.nameSource).toBe('')
  })

  it('does not fabricate a truncated "Token <id>" name when even the contract name is missing', () => {
    const { metadata } = toTokenMetadata('0xowner', '50885195465617477643146042682802822485667253724150135355861122402940664961076', '', '', 1n)

    expect(metadata.name).toBe('')
  })
})
