var assert = require('assert')
var fs = require('fs')
var util = require('ethereumjs-util')

const thresholdUpperBound = 100

const RstoreArtifact = require('../../build/contracts/Rstore.json')
const StandardStorageArtifact = require('../../build/contracts/StandardStorage.json')
const StandardCallerArtifact = require('../../build/contracts/StandardCaller.json')
const RstoreCallerArtifact = require('../../build/contracts/RstoreCaller.json')
const CodeCheckArtifact = require('../../build/contracts/CodeCheck.json')

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

module.exports = {test: async function (provider, testingContext) {
  var web3 = provider
  let passed = 0
  let failed = 0
  let gasUsage = {}
  console.log('running tests...')
  gasAnalysis = [[
    'threshold',
    'sstore(initial)', 'sstore(update)', 'sload(local)', 'sload(remote)',
    'cstore(initial)', 'cstore(update)', 'cload(local)', 'cload(remote)'
  ]]

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

  const RstoreDeployer = new web3.eth.Contract(
    RstoreArtifact.abi
  )

  const StandardStorageDeployer = new web3.eth.Contract(
    StandardStorageArtifact.abi
  )

  const StandardCallerDeployer = new web3.eth.Contract(
    StandardCallerArtifact.abi
  )

  const RstoreCallerDeployer = new web3.eth.Contract(
    RstoreCallerArtifact.abi
  )

  const CodeCheckDeployer = new web3.eth.Contract(
    CodeCheckArtifact.abi
  )


  for (let threshold = 0; threshold < thresholdUpperBound; threshold++) {
    gasRow = []

    let sstoreGas
    let cstoreGas
    let sloadGas
    let cloadGas

    let dataPayload = RstoreDeployer.deploy({
      data: RstoreArtifact.bytecode
    }).encodeABI()

    deployGas = await getDeployGas(dataPayload)

    const Rstore = await RstoreDeployer.deploy({
      data: RstoreArtifact.bytecode
    }).send({
      from: address,
      gas: deployGas,
      gasPrice: 10 ** 1
    }).catch(error => {
      console.error(error)
      console.log(
        ` ✘ Rstore contract deploys successfully for ${deployGas} gas`
      )
      failed++
      process.exit(1)
    })

    console.log(
      ` ✓ Rstore contract deploys successfully for ${deployGas} gas`
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

    values = '0x'+'f00d'.repeat(16 * threshold)
    await runTest(
      'StandardStorage can be set',
      StandardStorage,
      'set',
      'send',
      [values],
      true,
      receipt => {
        console.log(receipt.gasUsed)
        sstoreGas = receipt.gasUsed
      }
    )

    await runTest(
      'StandardStorage can be retrieved',
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
      'StandardStorage can be retrieved with updated values using send',
      StandardStorage,
      'get',
      'send',
      [],
      true,
      receipt => {
        console.log(receipt.gasUsed)
        sloadGas = receipt.gasUsed
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

    let sloadRemoteGas
    await runTest(
      'StandardCaller can retrieve values from StandardStorage via send',
      StandardCaller,
      'get',
      'send',
      [],
      true,
      receipt => {
        console.log(receipt.gasUsed)
        sloadRemoteGas = receipt.gasUsed
      }
    )  

    values = '0x'+'feed'.repeat(16 * threshold)
    let sstoreUpdateGas
    await runTest(
      'StandardStorage can be updated',
      StandardStorage,
      'set',
      'send',
      [values],
      true,
      receipt => {
        console.log(receipt.gasUsed)
        sstoreUpdateGas = receipt.gasUsed
      }
    )

    values = '0x'+'f00d'.repeat(16 * threshold)
    const metamorphicInitCode = '0x5860008158601c335a630c85c0028752fa153d602090039150607381533360601b600152653318585733ff60d01b601552602080808403918260d81b601b52602001903ef3'

    const metamorphic = getCreate2Address(
      Rstore.options.address,
      web3.utils.padLeft(address, 64),
      metamorphicInitCode
    )

    const addressBN = web3.utils.toBN(address)
    const one = web3.utils.toBN(1)
    const incrementedAddress = web3.utils.toHex(addressBN.add(one))

    const secondary = getCreate2Address(
      Rstore.options.address,
      web3.utils.padLeft(incrementedAddress, 64),
      metamorphicInitCode
    )

    await runTest(
      'Rstore can be set',
      Rstore,
      'set',
      'send',
      [values],
      true,
      receipt => {
        cstoreGas = receipt.gasUsed
        console.log(receipt.gasUsed)
      }
    )

    values = '0x'+'f00d'.repeat(16 * threshold)

    await runTest(
      'Rstore can retrieve values from storage',
      Rstore,
      'get',
      'call',
      [],
      true,
      value => {
        assert.strictEqual(value, values === '0x' ? null : values)
      }
    )

    await runTest(
      'Rstore can retrieve values from storage using send',
      Rstore,
      'get',
      'send',
      [],
      true,
      receipt => {
        console.log(receipt.gasUsed)
        cloadGas = receipt.gasUsed
      }
    )

    dataPayload = RstoreCallerDeployer.deploy({
      data: RstoreCallerArtifact.bytecode,
      arguments: [metamorphic, secondary]
    }).encodeABI()

    deployGas = await getDeployGas(dataPayload)

    const RstoreCaller = await RstoreCallerDeployer.deploy({
      data: RstoreCallerArtifact.bytecode,
      arguments: [metamorphic, secondary]
    }).send({
      from: address,
      gas: deployGas,
      gasPrice: 10 ** 1
    }).catch(error => {
      console.error(error)
      console.log(
        ` ✘ RstoreCaller deploys successfully for ${deployGas} gas`
      )
      failed++
      process.exit(1)
    })

    console.log(
      ` ✓ RstoreCaller deploys successfully for ${deployGas} gas`
    )
    passed++

    await runTest(
      'RstoreCaller can get the data',
      Rstore,
      'get',
      'call',
      [],
      true,
      value => {
        assert.strictEqual(value, values === '0x' ? null : values)
      }
    )

    let cloadRemoteGas
    await runTest(
      'RstoreCaller can get the data using send',
      Rstore,
      'get',
      'send',
      [],
      true,
      receipt => {
        console.log(receipt.gasUsed)
        cloadRemoteGas = receipt.gasUsed
      }
    )

    values = '0x'+'feed'.repeat(16 * threshold)
    let cstoreUpdateGas
    await runTest(
      'Rstore can be updated',
      Rstore,
      'set',
      'send',
      [values],
      true,
      receipt => {
        cstoreUpdateGas = receipt.gasUsed
        console.log(receipt.gasUsed)
      }
    )

    console.log(
      `completed ${passed + failed} test${passed + failed === 1 ? '' : 's'} ` +
      `with ${failed} failure${failed === 1 ? '' : 's'}.`
    )
    console.log('\nsize of storage:', threshold, 'words')
    console.log(`storage (initial): savings of ${sstoreGas - cstoreGas} gas (only ${Math.round(10000*cstoreGas/sstoreGas)/100}% as expensive) by using cstore`)
    console.log(`storage (update): savings of ${sstoreUpdateGas - cstoreUpdateGas} gas (only ${Math.round(10000*cstoreUpdateGas/sstoreUpdateGas)/100}% as expensive) by using cstore`)
    console.log(`retrieval (local): savings of ${sloadGas - cloadGas} gas (only ${Math.round(10000*cloadGas/sloadGas)/100}% as expensive) by using cload`)
    console.log(`retrieval (remote): savings of ${sloadRemoteGas - cloadRemoteGas} gas (only ${Math.round(10000*cloadRemoteGas/sloadRemoteGas)/100}% as expensive) by using cload`)

    gasRow = [
      threshold,
      sstoreGas, sstoreUpdateGas, sloadGas, sloadRemoteGas,
      cstoreGas, cstoreUpdateGas, cloadGas, cloadRemoteGas
    ]

    gasAnalysis.push(gasRow)

    if (failed > 0) {
      process.exit(1)
    }

  }

  console.log('\n')
  gasAnalysis.forEach(row => {
    console.log(`${row.join(',')}`)
  })

  fs.writeFile('./analysis.json', JSON.stringify(gasAnalysis), () => {})

  // exit.
  return 0

}}
