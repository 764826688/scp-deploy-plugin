# Overview 
deploy by scp command

After executing the 'npm run build' command, automatically deploy.

# Installation
```
npm i scp-deploy-plugin
```

# Basic Usage

```by privateKey
new ScpDeployPlugin({
  host: '127.0.0.1',
  port: 22,
  username: 'root',
  privateKey: '/User/xxx/.ssh/id_rsa', // absolute path
  projectPath: '/app/web/projectName' // contains index.html
})

```

```by password
new ScpDeployPlugin({
  host: '127.0.0.1',
  port: 22, 
  username: 'root',
  password: '***', // you need enter password again  when execute the scp command
  projectPath: '/app/web/projectName' // contains index.html
})

```
