const chalk = require("chalk");
const { execSync } = require("child_process");
const fs = require("fs");
const { Client } = require("ssh2");
const path = require('path');

const version = JSON.parse(fs.readFileSync(path.join(__dirname,'..','package.json'),{ encoding: 'utf-8'})).version;

const log  = {
  info: (msg) => console.log(`${chalk.bgBlue.black(' INFO ')}:\n${msg}`),
  warn: (msg) => console.log(`${chalk.bgYellow.black(' WARN ')}:\n${msg}`),
  done: (msg) => console.log(`${chalk.bgGreen.black(' DONE ')}:\n${msg}`),
  error: (msg) => console.log(`${chalk.bgRed(' ERROR ')}:\n${msg}`),
};


function checkFolderExists(path) {
  try {
    fs.accessSync(path, fs.constants.F_OK);
    return true;
  } catch (e) {
    return false;
  }
}


class ScpDeployPlugin {
  options = {};
  constructor(options = {}) {
    const { host, password, privateKey,projectPath } = options;
    if (!host) {
      console.error('host must not be empty!');
      return;
    }
    if (!projectPath) {
     console.error('projectPath must not be empty!')
     return;
    }
    if (!password && !privateKey) {
      console.error('password or privateKey must not be empty!');
      return;
    }
    if (privateKey) {
      options.privateKey = fs.readFileSync(privateKey)
    }
    this.options = { port: 22, username: 'root', backupProjectName: 'webadmin', ...options};
    this.version = version;
  }
  apply(compiler) {
    const { info, warn, error, done } = log;
    const { host, port, username, privateKey,password,projectPath, backupProjectName } = this.options;
    let hash = '';
    compiler.hooks.done.tap("deploy_scp", (stats) => {
      done(`Package completed,current directory is：${__dirname}`);
      hash = stats.hash;
      const outDir = compiler.options.output.path;
      
      // 检查dist文件是否为空
      const outputFiles = fs.readdirSync(outDir);
      if (checkFolderExists(outDir) && outputFiles.length > 0) {   
        // console.log(chalk.bgBlue.red(outputFiles.join('\n')))
        const client = new Client();
        client.connect({host, port, username, privateKey, password});

        // 命令在服务起一条条执行的，不能继承上下文
        const commands = [
          { name: `cd ${projectPath} 
            if [ -d "${projectPath}" ]; then 
              cd .. && ls || mkdir -p "${projectPath}"
            else 
              ls $(dirname ${projectPath}) || mkdir -p "${projectPath}"
            fi`, 
            output: '', msg: 'Before deletion:' },
          { name: `destPath=$(dirname ${projectPath})/.${backupProjectName} 
            if [ -d "$destPath" ]; then
             rm -rf $destPath && mv ${projectPath} $destPath
            else 
              if [ -d "${projectPath}" ]; then
                mv ${projectPath} $destPath
              else
                echo 'Initialization does not require creating a new directory:'
              fi;
            fi;`, msg: 'Delete and backup:'},
          // { name: `rm -rf ${projectPath}`, output: ''},
          { name: `cd ${projectPath} || ls $(dirname ${projectPath})`, output: '', msg: 'After deletion'}
        ]
      
        client.on("ready", () => {
          done('Establishing SSH connection')
          try {
            executeCommand();
          } catch (error) {
            // revert()
          }
        });

        // rollback
        function revert() {
          client.exec(`mv $(dirname ${projectPath})/.${backupProjectName} ${projectPath}`, (err, stream) => {
            if (err) {
              error(`Rollback failed:${err}`);
              throw err;
            }
            stream.on('exit', (code) => {
              done('Rollback successed');
            })
          })
        }

        function executeCommand () {
          if (commands.length == 0) {
           info('Command execution completed');
           return;
          }
          const command = commands.shift();
          client.exec(command.name, (err, stream) => {
            if (err) {
              throw(`${command.name}: ${err}`)
            }
            stream.on('data', data => {
              if (command.msg) {
                info(`${command.msg}：${data.toString()}`)
              }
            })
            stream.on('exit', (code) => {
              if (!commands.length) {
                done('Command execution completed, remote directory deletion successful');
                info('Starting file upload...');
                try {
                  let command = `scp -r ${outDir} ${username}@${host}:${projectPath}`;
                  execSync(command);
                  done('Folder upload successful!');
                  client.end();
                } catch (err) {
                  error('Client error occurred:', err);
                  client.end();
                  throw(err);
                }
                return;
              }
              if (code === 0) {
                executeCommand() 
              } else {
                throw(`${command.name}: ${err}`)
              }
            })
          })
        }

        
        client.on('error',err => {
          error(`Client error occurred:${err}`);
        })
        client.on('end',() => {
          warn(`Current hash is:${hash.slice(0,8)}`)
          info('SSH client closed');
        })
        client.on('timeout', () => {
          info('Connection timeout');
        })
      }
    });
  }
}

module.exports = ScpDeployPlugin;
