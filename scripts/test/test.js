var assert = require('assert')
var fs = require('fs')
var util = require('ethereumjs-util')

function getCreate2Address(sender, salt, initCode) {
  return util.toChecksumAddress(
    util.bufferToHex(
      util.generateAddress2(
        util.toBuffer(sender),
        util.toBuffer(salt),
        util.toBuffer(initCode)
      )
    )
  )
}

// 32000 + 200 ⋅ implementation_contract_bytes ( - 24000 refund?)

const RStoreArtifact = require('../../build/contracts/RStore.json')
const StandardStorageArtifact = require('../../build/contracts/StandardStorage.json')
const StandardCallerArtifact = require('../../build/contracts/StandardCaller.json')
const RStoreCallerArtifact = require('../../build/contracts/RStoreCaller.json')
const CodeCheckArtifact = require('../../build/contracts/CodeCheck.json')

module.exports = {test: async function (provider, testingContext) {
  var web3 = provider
  let passed = 0
  let failed = 0
  let gasUsage = {}
  console.log('running tests...')
  const threshold = 100
  const nullHash = '0x0000000000000000000000000000000000000000000000000000000000000000'

  // get available addresses and assign them to various roles
  const addresses = await web3.eth.getAccounts()
  if (addresses.length < 1) {
    console.log('cannot find enough addresses to run tests!')
    process.exit(1)
  }

  const originalAddress = addresses[0]

  async function send(
    title,
    instance,
    method,
    args,
    from,
    value,
    gas,
    gasPrice,
    shouldSucceed,
    assertionCallback
  ) {
    let succeeded = true
    receipt = await instance.methods[method](...args).send({
      from: from,
      value: value,
      gas: gas,
      gasPrice: gasPrice
    }).catch(error => {
      //console.error(error)
      succeeded = false
    })

    if (succeeded !== shouldSucceed) {
      return false
    } else if (!shouldSucceed) {
      return true
    }

    assert.ok(receipt.status)

    let assertionsPassed
    try {
      assertionCallback(receipt)
      assertionsPassed = true
    } catch(error) {
      assertionsPassed = false
    }

    return assertionsPassed
  }

  async function call(
    title,
    instance,
    method,
    args,
    from,
    value,
    gas,
    gasPrice,
    shouldSucceed,
    assertionCallback
  ) {
    let succeeded = true
    returnValues = await instance.methods[method](...args).call({
      from: from,
      value: value,
      gas: gas,
      gasPrice: gasPrice
    }).catch(error => {
      //console.error(error)
      succeeded = false
    })

    if (succeeded !== shouldSucceed) {
      return false
    } else if (!shouldSucceed) {
      return true
    }

    let assertionsPassed
    try {
      assertionCallback(returnValues)
      assertionsPassed = true
    } catch(error) {
      assertionsPassed = false
    }

    return assertionsPassed
  }

  async function runTest(
    title,
    instance,
    method,
    callOrSend,
    args,
    shouldSucceed,
    assertionCallback,
    from,
    value
  ) {
    if (typeof(callOrSend) === 'undefined') {
      callOrSend = 'send'
    }
    if (typeof(args) === 'undefined') {
      args = []
    }
    if (typeof(shouldSucceed) === 'undefined') {
      shouldSucceed = true
    }
    if (typeof(assertionCallback) === 'undefined') {
      assertionCallback = (value) => {}
    }
    if (typeof(from) === 'undefined') {
      from = address
    }
    if (typeof(value) === 'undefined') {
      value = 0
    }
    let ok = false
    if (callOrSend === 'send') {
      ok = await send(
        title,
        instance,
        method,
        args,
        from,
        value,
        gasLimit - 1,
        10 ** 1,
        shouldSucceed,
        assertionCallback
      )
    } else if (callOrSend === 'call') {
      ok = await call(
        title,
        instance,
        method,
        args,
        from,
        value,
        gasLimit - 1,
        10 ** 1,
        shouldSucceed,
        assertionCallback
      )
    } else {
      console.error('must use call or send!')
      process.exit(1)
    }

    if (ok) {
      console.log(` ✓ ${title}`)
      passed++
    } else {
      console.log(` ✘ ${title}`)
      failed++
    }
  }

  async function setupNewDefaultAddress(newPrivateKey) {
    const pubKey = await web3.eth.accounts.privateKeyToAccount(newPrivateKey)
    await web3.eth.accounts.wallet.add(pubKey)

    const txCount = await web3.eth.getTransactionCount(pubKey.address)

    if (txCount > 0) {
      console.warn(
        `warning: ${pubKey.address} has already been used, which may cause ` +
        'some tests to fail.'
      )
    }

    await web3.eth.sendTransaction({
      from: originalAddress,
      to: pubKey.address,
      value: 10 ** 18,
      gas: '0x5208',
      gasPrice: '0x4A817C800'
    })

    return pubKey.address
  }

  async function raiseGasLimit(necessaryGas) {
    iterations = 9999
    if (necessaryGas > 8000000) {
      console.error('the gas needed is too high!')
      process.exit(1)
    } else if (typeof necessaryGas === 'undefined') {
      iterations = 20
      necessaryGas = 8000000
    }

    // bring up gas limit if necessary by doing additional transactions
    var block = await web3.eth.getBlock("latest")
    while (iterations > 0 && block.gasLimit < necessaryGas) {
      await web3.eth.sendTransaction({
        from: originalAddress,
        to: originalAddress,
        value: '0x01',
        gas: '0x5208',
        gasPrice: '0x4A817C800'
      })
      var block = await web3.eth.getBlock("latest")
      iterations--
    }

    console.log("raising gasLimit, currently at " + block.gasLimit)
    return block.gasLimit
  }

  async function getDeployGas(dataPayload) {
    await web3.eth.estimateGas({
      from: address,
      data: dataPayload
    }).catch(async error => {
      if (
        error.message === (
          'Returned error: gas required exceeds allowance or always failing ' +
          'transaction'
        )
      ) {
        await raiseGasLimit()
        await getDeployGas(dataPayload)
      }
    })

    deployGas = await web3.eth.estimateGas({
      from: address,
      data: dataPayload
    })

    return deployGas
  }

  // *************************** deploy contracts *************************** //
  let address = await setupNewDefaultAddress(
    '0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed'
  )

  let deployGas
  let latestBlock = await web3.eth.getBlock('latest')
  const gasLimit = latestBlock.gasLimit

  const RStoreDeployer = new web3.eth.Contract(
    RStoreArtifact.abi
  )

  const StandardStorageDeployer = new web3.eth.Contract(
    StandardStorageArtifact.abi
  )

  const StandardCallerDeployer = new web3.eth.Contract(
    StandardCallerArtifact.abi
  )

  const RStoreCallerDeployer = new web3.eth.Contract(
    RStoreCallerArtifact.abi
  )

  const CodeCheckDeployer = new web3.eth.Contract(
    CodeCheckArtifact.abi
  )

  let dataPayload = RStoreDeployer.deploy({
    data: RStoreArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const RStore = await RStoreDeployer.deploy({
    data: RStoreArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ RStore contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ RStore contract deploys successfully for ${deployGas} gas`
  )
  passed++

  dataPayload = StandardStorageDeployer.deploy({
    data: StandardStorageArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const StandardStorage = await StandardStorageDeployer.deploy({
    data: StandardStorageArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ StandardStorage contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ StandardStorage contract deploys successfully for ${deployGas} gas`
  )
  passed++

  dataPayload = StandardCallerDeployer.deploy({
    data: StandardCallerArtifact.bytecode,
    arguments: [StandardStorage.options.address]
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const StandardCaller = await StandardCallerDeployer.deploy({
    data: StandardCallerArtifact.bytecode,
    arguments: [StandardStorage.options.address]
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ StandardCaller deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ StandardCaller deploys successfully for ${deployGas} gas`
  )
  passed++

  dataPayload = CodeCheckDeployer.deploy({
    data: CodeCheckArtifact.bytecode
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const CodeCheck = await CodeCheckDeployer.deploy({
    data: CodeCheckArtifact.bytecode
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ CodeCheck contract deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ CodeCheck contract deploys successfully for ${deployGas} gas`
  )
  passed++

  let values = (
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' +
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )
  

  await runTest(
    'StandardStorage can be set',
    StandardStorage,
    'set',
    'send',
    [values]
  )

  await runTest(
    'StandardStorage can be retrieved',
    StandardStorage,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values)
    }
  )

  await runTest(
    'StandardCaller can retrieve values from StandardStorage',
    StandardCaller,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values)
    }
  )

  values = (
    '0xa0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
    'b0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
    'c0cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
    'd0dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' +
    'e0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )
  

  await runTest(
    'StandardStorage can be updated',
    StandardStorage,
    'set',
    'send',
    [values]
  )

  await runTest(
    'StandardStorage can be retrieved with updated values',
    StandardStorage,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values)
    }
  )

  await runTest(
    'StandardCaller can retrieve updated values from StandardStorage',
    StandardCaller,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values)
    }
  )

  values = '0x'+'f00d'.repeat(16 * threshold)
  await runTest(
    'StandardStorage can be set using a large input array',
    StandardStorage,
    'set',
    'send',
    [values]
  )

  await runTest(
    'StandardStorage can be retrieved with updated values',
    StandardStorage,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values === '0x' ? null : values)
    }
  )

  await runTest(
    'StandardCaller can retrieve values from StandardStorage',
    StandardCaller,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values === '0x' ? null : values)
    }
  ) 

  let metamorphicInitCode
  await runTest(
    'RStore can get the init code',
    RStore,
    'getMetamorphicStorageContractInitializationCode',
    'call',
    [],
    true,
    value => {
      metamorphicInitCode = value
    }
  )

  const metamorphic = getCreate2Address(
    RStore.options.address,
    web3.utils.padLeft(address, 64),
    metamorphicInitCode
  )

  const addressBN = web3.utils.toBN(address)
  const one = web3.utils.toBN(1)
  const incrementedAddress = web3.utils.toHex(addressBN.add(one))

  const secondary = getCreate2Address(
    RStore.options.address,
    web3.utils.padLeft(incrementedAddress, 64),
    metamorphicInitCode
  )

  values = (
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
    'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' +
    'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )

  await runTest(
    'RStore can set values',
    RStore,
    'set',
    'send',
    [values]
  )

  await runTest(
    'RStore retrieves no value from transient storage after set has completed',
    RStore,
    'getTransientStorage',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, null)
    }
  )

  expectedContractCode = (
    '0x73' +
    web3.utils.toHex(RStore.options.address).slice(2) +
    '3318585733ff' +
    (values.length / 2 - 1).toString(16).padStart(10, '0') +
    values.slice(2)
  )

  await runTest(
    'CodeCheck can check the code of the metamorphic storage contract',
    CodeCheck,
    'check',
    'call',
    [metamorphic],
    true,
    value => {
      assert.strictEqual(value, expectedContractCode)   
    }
  )

  await runTest(
    'CodeCheck can check the hash of the metamorphic storage contract',
    CodeCheck,
    'hash',
    'call',
    [metamorphic],
    true,
    value => { 
      assert.strictEqual(
        value,
        web3.utils.keccak256(expectedContractCode, {encoding: 'hex'})
      )   
    }
  )

  await runTest(
    'CodeCheck confirms that secondary metamorphic contract does not exist yet',
    CodeCheck,
    'hash',
    'call',
    [
      secondary
    ],
    true,
    value => { 
      assert.strictEqual(value, nullHash)   
    }
  )

  values = (
    '0xa0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
    'b0bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' +
    'c0cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' +
    'd0dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' +
    'e0eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
  )

  await runTest(
    'RStore can be updated with new values once it has been cleared',
    RStore,
    'set',
    'send',
    [values]
  )

  expectedContractCode = (
    '0x73' +
    web3.utils.toHex(RStore.options.address).slice(2) +
    '3318585733ff' +
    (values.length / 2 - 1).toString(16).padStart(10, '0') +
    values.slice(2)
  )

  await runTest(
    'CodeCheck can check the code of the metamorphic storage contract',
    CodeCheck,
    'check',
    'call',
    [secondary],
    true,
    value => {
      assert.strictEqual(value, expectedContractCode)
    }
  )

  await runTest(
    'CodeCheck confirms the primary metamorphic storage contract is gone',
    CodeCheck,
    'hash',
    'call',
    [metamorphic],
    true,
    value => {
      assert.strictEqual(value, nullHash)
    }
  )

  await runTest(
    'CodeCheck can check the hash of the secondary metamorphic storage contract',
    CodeCheck,
    'hash',
    'call',
    [secondary],
    true,
    value => { 
      assert.strictEqual(
        value,
        web3.utils.keccak256(expectedContractCode, {encoding: 'hex'})
      ) 
    }
  )

  values = '0x'+'f00d'.repeat(16 * threshold)
  await runTest(
    'RStore can be updated with a large input array',
    RStore,
    'set',
    'send',
    [values]
  )

  await runTest(
    'RStore can retrieve values from storage',
    RStore,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values === '0x' ? null : values)
    }
  )

  await runTest(
    'RStore can get the init code hash',
    RStore,
    'getMetamorphicStorageContractInitializationCodeHash',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(
        value,
        web3.utils.keccak256(metamorphicInitCode, {encoding: 'hex'})
      )
    }
  )

  expectedContractCode = (
    '0x73' +
    web3.utils.toHex(RStore.options.address).slice(2) +
    '3318585733ff' +
    (values.length / 2 - 1).toString(16).padStart(10, '0') +
    values.slice(2)
  )

  await runTest(
    'CodeCheck can check the hash of the metamorphic storage contract',
    CodeCheck,
    'hash',
    'call',
    [metamorphic],
    true,
    value => { 
      assert.strictEqual(
        value,
        web3.utils.keccak256(expectedContractCode, {encoding: 'hex'})
      ) 
    }
  )

  await runTest(
    'CodeCheck confirms that secondary metamorphic storage contract is gone',
    CodeCheck,
    'hash',
    'call',
    [secondary],
    true,
    value => {
      assert.strictEqual(value, nullHash)
    }
  )

  dataPayload = RStoreCallerDeployer.deploy({
    data: RStoreCallerArtifact.bytecode,
    arguments: [metamorphic, secondary]
  }).encodeABI()

  deployGas = await getDeployGas(dataPayload)

  const RStoreCaller = await RStoreCallerDeployer.deploy({
    data: RStoreCallerArtifact.bytecode,
    arguments: [metamorphic, secondary]
  }).send({
    from: address,
    gas: deployGas,
    gasPrice: 10 ** 1
  }).catch(error => {
    console.error(error)
    console.log(
      ` ✘ RStoreCaller deploys successfully for ${deployGas} gas`
    )
    failed++
    process.exit(1)
  })

  console.log(
    ` ✓ RStoreCaller deploys successfully for ${deployGas} gas`
  )
  passed++

  await runTest(
    'RStoreCaller can get the data',
    RStore,
    'get',
    'call',
    [],
    true,
    value => {
      assert.strictEqual(value, values === '0x' ? null : values)
    }
  )  

  console.log(
    `completed ${passed + failed} test${passed + failed === 1 ? '' : 's'} ` +
    `with ${failed} failure${failed === 1 ? '' : 's'}.`
  )

  if (failed > 0) {
    process.exit(1)
  }

  // exit.
  return 0

}}
