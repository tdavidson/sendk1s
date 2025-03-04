# k1distribution
 
This folder covers a script created to send K1 tax documents to limited partners for Laconia Capital Group.

1. Put the unencrypted K1s in a folder in the `/docs` folder, which is ignored by git.
2. Run the script, passing in the name of the folder to process.

```
node k1script.js [name of folder]
```

3. The encrypted folders will be created in the `/docs` folder with the same folder name, with `_protected` appended.
4. The script will create a CSV file in the `/docs` folder, with the same name as the folder, but with a `_passwords` suffix. You can use this to verify the passwords are correct and the script worked correctly. Please note this should stay in the `/docs` folder so it is ignored by git.
