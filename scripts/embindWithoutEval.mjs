// Basis Universal's transcoder, as three.js ships it, is built with Emscripten's embind, which
// writes the wrappers between JavaScript and WebAssembly as source text and compiles them with
// `new Function`. The webview's CSP forbids that (it would need 'unsafe-eval'), so the build swaps
// both wrapper generators for closures that do the same work, as Emscripten's own build without
// dynamic execution does. A transcoder that doesn't match fails the build rather than the webview.

/** Wraps a C++ function or method so JavaScript can call it with JavaScript values. */
const invoker = `function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){
  var argCount=argTypes.length;
  if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and 'this' types!")}
  var isClassMethodFunc=argTypes[1]!==null&&classType!==null;
  var needsDestructorStack=usesDestructorStack(argTypes);
  var returns=argTypes[0].name!=="void";
  var expected=argCount-2;
  var invokerFn=function(...args){
    if(args.length!==expected){throwBindingError("function "+humanName+" called with "+args.length+" arguments, expected "+expected)}
    var destructors=needsDestructorStack?[]:null;
    var wired=[];
    if(isClassMethodFunc){wired.push(argTypes[1]["toWireType"](destructors,this))}
    for(var i=0;i<expected;++i){wired.push(argTypes[i+2]["toWireType"](destructors,args[i]))}
    var rv=cppInvokerFunc(cppTargetFunc,...wired);
    if(needsDestructorStack){runDestructors(destructors)}else{
      for(var i=isClassMethodFunc?1:2;i<argCount;++i){
        if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(wired[isClassMethodFunc?i-1:i-2])}
      }
    }
    if(returns){return argTypes[0]["fromWireType"](rv)}
  };
  return createNamedFunction(humanName,invokerFn)
}`;

/** Lets C++ call a JavaScript function or constructor with arguments read from its memory. */
const methodCaller = `var __emval_get_method_caller=(argCount,argTypes,kind)=>{
  var types=emval_lookupTypes(argCount,argTypes);var retType=types.shift();argCount--;
  var invokerFunction=function(obj,func,destructorsRef,args){
    var values=[];var offset=0;
    for(var i=0;i<argCount;++i){values.push(types[i]["readValueFromPointer"](args+offset));offset+=types[i]["argPackAdvance"]}
    var rv=kind===1?reflectConstruct(func,values):func.apply(obj,values);
    if(!retType.isVoid){return emval_returnValue(retType,destructorsRef,rv)}
  };
  var functionName=\`methodCaller<(\${types.map(t=>t.name).join(", ")}) => \${retType.name}>\`;
  return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))
};`;

const REPLACEMENTS = [
  {
    start:
      'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){',
    end: 'return createNamedFunction(humanName,invokerFn)}',
    with: invoker,
  },
  {
    start: 'var __emval_get_method_caller=(argCount,argTypes,kind)=>{',
    end: 'return emval_addMethodCaller(createNamedFunction(functionName,invokerFunction))};',
    with: methodCaller,
  },
];

/** `source` with embind's code generation replaced; throws if it isn't the transcoder expected. */
export function embindWithoutEval(source) {
  let result = source;
  for (const replacement of REPLACEMENTS) {
    const start = result.indexOf(replacement.start);
    const end = result.indexOf(replacement.end, start);
    if (start < 0 || end < 0 || result.indexOf(replacement.start, start + 1) >= 0) {
      throw new Error(`embind code not found as expected: ${replacement.start}`);
    }
    result = result.slice(0, start) + replacement.with + result.slice(end + replacement.end.length);
  }
  if (/newFunc\(Function|new Function|\beval\(/.test(result)) {
    throw new Error('the transcoder still compiles code at run time');
  }
  return result;
}
