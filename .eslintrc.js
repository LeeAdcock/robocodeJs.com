module.exports = {
    "env": {
        "browser": true,
        "es6": true,
        "node": true
    },
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint",
    ],
    "rules": {
        "@typescript-eslint/prefer-optional-chain": "off",
        "@typescript-eslint/adjacent-overload-signatures": "error",
        "@typescript-eslint/class-name-casing": "error",
        "@typescript-eslint/consistent-type-assertions": "error",
        "@typescript-eslint/indent": "off",
        "@typescript-eslint/member-delimiter-style": [
            "off",
            {
                "multiline": {
                    "delimiter": "semi",
                    "requireLast": true
                },
                "singleline": {
                    "delimiter": "semi",
                    "requireLast": false
                }
            }
        ],
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-empty-interface": "error",
        "@typescript-eslint/no-inferrable-types": "off",
        "@typescript-eslint/no-use-before-define": "error",
        "@typescript-eslint/quotes": "off",
        "@typescript-eslint/semi": [
            "off",
            "always"
        ],
        "@typescript-eslint/space-within-parens": [
            "off",
            "never"
        ],
        "@typescript-eslint/type-annotation-spacing": "error",
        "@typescript-eslint/unified-signatures": "error",
        "arrow-body-style": [
            "error",
            "as-needed"
        ],
        "arrow-parens": [
            "off",
            "as-needed"
        ],
        "camelcase": "error",
        "comma-dangle": "off",
        "curly": "off",
        "eol-last": "off",
        "eqeqeq": [
            "error",
            "always"
        ],
        "id-match": "error",
        "linebreak-style": "off",
        "max-len": "off",
        "max-lines": [
            "error",
            800
        ],
        "new-parens": "off",
        "newline-per-chained-call": "off",
        "no-debugger": "error",
        "no-empty": "off",
        "no-extra-semi": "off",
        "no-irregular-whitespace": "off",
        "no-multiple-empty-lines": "off",
        "no-redeclare": "error",
        "no-shadow": [
            "error",
            {
                "hoist": "all"
            }
        ],
        "no-throw-literal": "error",
        "no-trailing-spaces": "error",
        "no-underscore-dangle": "error",
        "no-unused-expressions": "error",
        "no-var": "error",
        "prefer-const": "error",
        "quote-props": "off",
        "space-before-function-paren": "off",
    }
};
