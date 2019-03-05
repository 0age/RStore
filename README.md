# RStore

![GitHub](https://img.shields.io/github/license/0age/RStore.svg?colorB=brightgreen)
[![Build Status](https://travis-ci.org/0age/RStore.svg?branch=master)](https://travis-ci.org/0age/RStore)
[![standard-readme compliant](https://img.shields.io/badge/standard--readme-OK-green.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

> RStore - use the runtime code of metamorphic contracts for dynamic storage.

This contract uses metamorphic contracts in place of standard storage in order to save gas for certain applications. Then, `extcodecopy` is used to retrieve values from the runtime code of a metamorphic contract, which can be redeployed after a selfdestruct in order to update storage. This is bleeding-edge stuff, so use at your own risk!

There are actually two different metamorphic contracts that are used in alternating order to support single-transaction storage updates. Each caller also has their own, independent associated metamorphic storage contracts. Gas usage can almost certainly be optimized further from here - this is meant to serve as a proof-of-concept of using contract runtime code for storage.

**DISCLAIMER: this implements a few highly experimental features - be sure to *educate the users of your contract* if it will rely on metamorphic contracts for storage! These contracts have not yet been fully tested or audited - proceed with caution and please share any exploits or optimizations you discover.**

For additional context and an explanation of the initialization code used to deploy metamorphic storage contracts, check out [this post](https://medium.com/@0age/on-efficient-ethereum-storage-c76869591add). 

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [API](#api)
- [Maintainers](#maintainers)
- [Contribute](#contribute)
- [License](#license)

## Install
To install locally, you'll need Node.js 10+ and Yarn *(or npm)*. To get everything set up:
```sh
$ git clone https://github.com/0age/RStore.git
$ cd RStore
$ yarn install
$ yarn build
```

## Usage
In a new terminal window, start the testRPC, run tests, and tear down the testRPC *(you can do all of this at once via* `yarn all` *if you prefer)*:
```sh
$ yarn start
$ yarn test
$ yarn linter
$ yarn analyze # this takes a while and is for calculating gas usage
$ yarn stop
```

## API

See the source code of the contracts for usage information. It's really quite simple - basically just `set(bytes calldata data)` and `get()`, plus some convenience view functions.

## Maintainers

[@0age](https://github.com/0age)

## Contribute

PRs accepted gladly - make sure the tests and linters pass.

## License

MIT © 2019 0age
