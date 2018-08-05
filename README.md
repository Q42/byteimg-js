# byteimg-js

⚠️ _Work in Progress!_

Examples:

```javascript
const alice = await byteimg.fromOriginal('alice.jpg')
const bob = await byteimg.fromOriginal('bob.jpg')

// Send single header, multiple bodies
console.log('shared header', alice.header)
console.log('body 1', alice.body)
console.log('body 2', bob.body)

// Save joined file for later use
await alice.writeByteimgFile('alice.byteimg')

// Recreate small image
const imageBuffer = alice.toImage()
```

## Binary format for body

```
byte | description
------------------
0      format version
1,2    original width
3,4    original height
5      small width
6      small height
7,8    header byte count
9,10   body byte count
[rest] JPEG body
```