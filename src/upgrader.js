const Spinner = require('cli-spinner').Spinner
const chalk = require('chalk')
const inquirer = require('inquirer')

const powershell = require('./powershell')
const utils = require('./utils')
const strings = require('./strings')
const versions = require('./versions')
const findNpm = require('./find-npm')
const debug = require('./debug')

const regeneratorRuntime = regeneratorRuntime || require('regenerator-runtime-only')

class Upgrader {
  constructor (program) {
    this.options = program
  }

  async ensureInternet () {
    if (!this.options.noDnsCheck) {
      const isOnline = await utils.checkInternetConnection()

      if (!isOnline) {
        utils.exit(1, strings.noInternet)
      }
    }
  }

  async ensureExecutionPolicy () {
    if (!this.options.noExecutionPolicyCheck) {
      try {
        const isExecutable = await utils.checkExecutionPolicy()

        if (!isExecutable) {
          utils.exit(1, strings.noExecutionPolicy)
        }
      } catch (err) {
        utils.exit(1, strings.executionPolicyCheckError, err)
      }
    }
  }

  async wasUpgradeSuccessful () {
    this.installedVersion = await versions.getInstalledNPMVersion()
    return (this.installedVersion === this.options.npmVersion)
  }

  async chooseVersion () {
    if (!this.options.npmVersion) {
      const availableVersions = await versions.getAvailableNPMVersions()
      const versionList = [{
        type: 'list',
        name: 'version',
        message: 'Which version do you want to install?',
        choices: availableVersions.reverse()
      }]

      this.options.npmVersion = await inquirer.prompt(versionList)
        .then(answer => answer.version)
    }

    if (this.options.npmVersion === 'latest') {
      this.options.npmVersion = await versions.getLatestNPMVersion()
    }
  }

  async choosePath () {
    try {
      this.options.npmPath = await findNpm(this.options.npmPath)
      debug(`Upgrader: Chosen npm path: ${this.options.npmPath}`)
    } catch (err) {
      utils.exit(1, err)
    }
  }

  /**
   * Attempts a simple upgrade, eventually calling npm install -g npm
   *
   * @param {string} version - Version that should be installed
   */
  async upgradeSimple () {
    this.spinner = new Spinner(`${strings.startingUpgradeSimple} %s`)

    if (this.options.noSpinner || this.options.noPrompt) {
      console.log(strings.startingUpgradeSimple)
    } else {
      this.spinner.start()
    }

    const output = await powershell.runSimpleUpgrade(this.options.npmVersion)

    this.spinner.stop(false)
    console.log('\n')

    if (output.error) {
      throw output.error
    }
  }

  /**
   * Upgrades npm in the correct directory, securing and reapplying
   * existing configuration
   *
   * @param  {string} version - Version that should be installed
   * @param  {string} npmPath - Path where npm should be installed
   */
  async upgradeComplex () {
    this.spinner = new Spinner(`${strings.startingUpgradeComplex} %s`)

    if (this.options.noSpinner || this.options.noPrompt) {
      console.log(strings.startingUpgradeComplex)
    } else {
      this.spinner.start()
    }

    const output = await powershell.runUpgrade(this.options.npmVersion, this.options.npmPath)

    this.spinner.stop(false)
    console.log('\n')

    // If we failed to elevate to administrative rights, we have to abort.
    if (output.stdout[0] && output.stdout[0].includes('NOTADMIN')) {
      utils.exit(1, strings.noAdmin)
    }
  }

  upgrade () {
    debug('Starting upgrade')

    return this.upgradeComplex()
      .then(() => this.wasUpgradeSuccessful())
      .then(isDone => {
        if (isDone) {
          // Awesome, the upgrade worked!
          utils.exit(0, strings.upgradeFinished(this.installedVersion))
        } else {
          return this.upgradeSimple()
        }
      })
      .then(() => this.wasUpgradeSuccessful())
      .then(isDone => {
        if (isDone) {
          // Awesome, the upgrade worked!
          utils.exit(0, strings.upgradeFinished(this.installedVersion))
        } else {
          this.logUpgradeFailure()
        }
      })
      .catch((err) => console.log(err))
  }

  logUpgradeFailure (...errors) {
    // Uh-oh, something didn't work as it should have.
    versions.getVersions().then((debugVersions) => {
      let info

      if (this.options.npmVersion && this.installedVersion) {
        info = `You wanted to install npm ${this.options.npmVersion}, but the installed version is ${this.installedVersion}.\n\n`
        info += 'A common reason is an attempted "npm install npm" or "npm upgrade npm".'
        info += 'As of today, the only solution is to completely uninstall and then reinstall Node.js.'
        info += 'For a small tutorial, please see http://aka.ms/fix-npm-upgrade.\n'
      } else if (this.options.npmVersion) {
        info = `You wanted to install npm ${this.options.npmVersion}, but we could not confirm that the installation succeeded.`
      } else {
        info = 'We encountered an error during installation.\n'
      }

      info += 'Please consider reporting your trouble to http://aka.ms/npm-issues.'

      console.log(chalk.red(info))

      console.log(chalk.bold('\nDebug Information:\n'))
      console.log(debugVersions)

      if (errors && errors.length && errors.length > 0) console.log('Here is the error:')

      // If we just got an error string (we shouldn't handle that)
      if (typeof errors !== 'string') {
        console.log('\n' + errors + '\n')
        return process.exit(1)
      }

      for (let i = 0; i < errors.length; i++) {
        console.log('\n' + errors[i] + '\n')
      }

      setTimeout(() => {
        process.exit(1)
      }, 1000)
    })
  }
}

module.exports = Upgrader
