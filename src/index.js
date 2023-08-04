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
      done(`结束打包,当前目录：${__dirname}`);
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
            output: '', msg: '删除前' },
          { name: `destPath=$(dirname ${projectPath})/.${backupProjectName} 
            if [ -d "$destPath" ]; then
             rm -rf $destPath && mv ${projectPath} $destPath
            else 
              if [ -d "${projectPath}" ]; then
                mv ${projectPath} $destPath
              else
                echo '初始化无需新建目录'
              fi;
            fi;`, msg: '删除并备份'},
          // { name: `rm -rf ${projectPath}`, output: ''},
          { name: `cd ${projectPath} || ls $(dirname ${projectPath})`, output: '', msg: '删除后'}
        ]
      
        client.on("ready", () => {
          done('SSH建立链接')
          try {
            executeCommand();
          } catch (error) {
            // revert()
          }
        });

        // 回滚上一次
        function revert() {
          client.exec(`mv $(dirname ${projectPath})/.${backupProjectName} ${projectPath}`, (err, stream) => {
            if (err) {
              error(`回滚失败:${err}`);
              throw err;
            }
            stream.on('exit', (code) => {
              done('回滚成功');
            })
          })
        }

        function executeCommand () {
          if (commands.length == 0) {
           info('命令执行完毕');
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
                done('命令执行完毕,删除远程目录成功');
                info('开始文件上传...');
                try {
                  let command = `scp -r ${outDir} ${username}@${host}:${projectPath}`;
                  execSync(command);
                  done('文件夹上传成功！');
                  client.end();
                } catch (err) {
                  error('文件夹上传失败：', err);
                  client.end();
                  throw(err);
                }
                // client.sftp((err,sftp) => {
                //   if (err) {
                //     throw err;
                //   }
                //   function uploadFile(sourcePath,remotePath) {
                //     if (!sourcePath || !remotePath) return Promise.reject();
                //     return new Promise((resolve,reject) => {
                //       // sftp.fastPut(sourcePath,remotePath,(err) => {
                //       //   if (err) {
                //       //     console.log(err)
                //       //     return reject(err);
                //       //   }
                //       //   resolve();
                //       // });
                //       const readStream = fs.createReadStream(sourcePath);
                //       const writeStream = sftp.createWriteStream(remotePath);
                //       readStream.pipe(writeStream);
                //       writeStream.on('close',() => resolve());
                //       writeStream.on('error',(err) => reject(`文件上传失败${err}`))
                //     })
                //   }

                //   function mkdir(path) {
                //     if (!path) return Promise.reject();
                //     return new Promise((resolve,reject) => {
                //       sftp.mkdir(path,err => {
                //         if (err) {
                //           return reject(err);  
                //         }
                //         resolve();
                //       })
                //     })
                //   }
                  
                //  async function uploadDir(_localpath,_remotePath) {
                //     // 非文件夹禁止上传
                //     if (!checkFolderExists(_localpath)) return;
                //     const files = fs.readdirSync(_localpath);
                //     if (!files.length) return;
                //     for (const file of files) {
                //       const localFilePath = path.join(_localpath, file);
                //       const stats = fs.statSync(localFilePath);
                //       if (stats.isFile()) {
                //         // info(`${localFilePath},${_remotePath}`)
                //         await uploadFile(localFilePath,_remotePath)
                //         info(`upload ${file} successed`);
                //       } else if (stats.isDirectory()) {
                //         const remoteFilePath = path.join(_remotePath,file);
                //         await mkdir(remoteFilePath);
                //         uploadDir(localFilePath,remoteFilePath);
                //       }
                //     }
                //   }
                //   try {
                //     mkdir(`${projectPath}`).then(() => {
                //       uploadDir(outDir, `${projectPath}`).catch(err => error(err))
                //     }).catch(err => {
                //       error(err)
                //     })
                //     // done('文件上传成功');
                //   } catch (err) {
                //     error(`上传文件发生错误：${err}`)
                //   }
                // })
                // client.end();
                return;
              }
              if (code === 0) {
                executeCommand() 
              } else {
                // error(`命令执行失败，即将退出...,${chalk.red(err)}`);
                throw(`${command.name}: ${err}`)
              }
            })
          })
        }

        
        client.on('error',err => {
          error(`客户端发生错误：${err}`);
        })
        client.on('end',() => {
          warn(`当前hash是:${hash.slice(0,8)}`)
          info('SSH客户端关闭');
        })
        client.on('timeout', () => {
          info('链接超时');
        })
      }
    });
  }
}

module.exports = ScpDeployPlugin;
