(module
  (type $t0 (func (result f64 i32)))
  (type $t1 (func (param f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32 f64 i32) (result f64)))
  (type $t2 (func (param f64 i32) (result f64)))
  (type $t3 (func (param f64) (result f64)))
  (func $m (export "m") (type $t0) (result f64 i32)
    (f64.const 0x0p+0 (;=0;))
    (i32.const 0))
  (func $applyRulesWasm (export "applyRulesWasm") (type $t1) (param $p0 f64) (param $p1 i32) (param $p2 f64) (param $p3 i32) (param $p4 f64) (param $p5 i32) (param $p6 f64) (param $p7 i32) (param $p8 f64) (param $p9 i32) (param $p10 f64) (param $p11 i32) (param $p12 f64) (param $p13 i32) (param $p14 f64) (param $p15 i32) (param $p16 f64) (param $p17 i32) (param $p18 f64) (param $p19 i32) (param $p20 f64) (param $p21 i32) (param $p22 f64) (param $p23 i32) (param $p24 f64) (param $p25 i32) (param $p26 f64) (param $p27 i32) (result f64)
    (local $l28 f64) (local $l29 f64) (local $l30 f64) (local $l31 f64) (local $l32 f64) (local $l33 f64) (local $l34 f64) (local $l35 f64) (local $l36 f64) (local $l37 f64) (local $l38 f64) (local $l39 f64) (local $l40 f64) (local $l41 f64) (local $l42 f64) (local $l43 f64) (local $l44 f64) (local $l45 f64) (local $l46 f64) (local $l47 f64) (local $l48 f64) (local $l49 i32) (local $l50 i32) (local $l51 f64) (local $l52 f64) (local $l53 f64) (local $l54 f64) (local $l55 f64) (local $l56 f64) (local $l57 f64) (local $l58 f64) (local $l59 f64) (local $l60 f64) (local $l61 f64) (local $l62 f64) (local $l63 f64) (local $l64 f64) (local $l65 f64) (local $l66 f64)
    (local.set $l28
      (f64.const 0x0p+0 (;=0;)))
    (local.set $l29
      (f64.sub
        (f64.const 0x1p+0 (;=1;))
        (local.get $p26)))
    (local.set $l30
      (f64.convert_i32_u
        (f64.ne
          (local.get $p10)
          (f64.const 0x0p+0 (;=0;)))))
    (local.set $l31
      (f64.convert_i32_u
        (f64.gt
          (local.get $p18)
          (f64.const 0x0p+0 (;=0;)))))
    (local.set $l32
      (f64.mul
        (f64.const 0x1.9p+6 (;=100;))
        (local.get $p10)))
    (local.set $l33
      (f64.const 0x1.999999999999ap-4 (;=0.1;)))
    (local.set $l34
      (local.get $p0))
    (local.set $l35
      (f64.const 0x0p+0 (;=0;)))
    (loop $L0
      (if $I1
        (f64.lt
          (local.get $l35)
          (local.get $p2))
        (then
          (local.set $l36
            (f64.load align=1
              (i32.trunc_sat_f64_s
                (local.get $l34))))
          (local.set $l37
            (f64.load offset=8 align=1
              (i32.trunc_sat_f64_s
                (local.get $l34))))
          (local.set $l39
            (f64.mul
              (local.tee $l38
                (f64.load offset=32 align=1
                  (i32.trunc_sat_f64_s
                    (local.get $l34))))
              (local.get $p8)))
          (local.set $l40
            (f64.load align=1
              (i32.trunc_sat_f64_s
                (f64.add
                  (local.get $p6)
                  (f64.mul
                    (local.get $l38)
                    (f64.const 0x1p+3 (;=8;)))))))
          (local.set $l41
            (f64.const 0x0p+0 (;=0;)))
          (local.set $l42
            (f64.const 0x0p+0 (;=0;)))
          (local.set $l43
            (local.get $p0))
          (local.set $l44
            (f64.const 0x0p+0 (;=0;)))
          (loop $L2
            (if $I3
              (f64.lt
                (local.get $l44)
                (local.get $p2))
              (then
                (local.set $l45
                  (f64.load align=1
                    (i32.trunc_sat_f64_s
                      (local.get $l43))))
                (local.set $l46
                  (f64.load offset=8 align=1
                    (i32.trunc_sat_f64_s
                      (local.get $l43))))
                (local.set $l47
                  (f64.sub
                    (local.get $l36)
                    (local.get $l45)))
                (local.set $l48
                  (f64.sub
                    (local.get $l37)
                    (local.get $l46)))
                (if $I5
                  (f64.ne
                    (f64.convert_i32_s
                      (if $I4 (result i32)
                        (i32.eqz
                          (local.tee $l49
                            (f64.ne
                              (local.get $l47)
                              (f64.const 0x0p+0 (;=0;)))))
                        (then
                          (f64.ne
                            (local.get $l48)
                            (f64.const 0x0p+0 (;=0;)))
                          (local.set $l50
                            (i32.const 2)))
                        (else
                          (local.get $l49)
                          (local.set $l50
                            (i32.const 2)))))
                    (f64.const 0x0p+0 (;=0;)))
                  (then
                    (if $I6
                      (f64.ne
                        (f64.convert_i32_u
                          (f64.lt
                            (local.tee $l51
                              (f64.add
                                (f64.mul
                                  (local.get $l47)
                                  (local.get $l47))
                                (f64.mul
                                  (local.get $l48)
                                  (local.get $l48))))
                            (local.get $l40)))
                        (f64.const 0x0p+0 (;=0;)))
                      (then
                        (local.set $l52
                          (f64.load offset=32 align=1
                            (i32.trunc_sat_f64_s
                              (local.get $l43))))
                        (local.set $l54
                          (f64.div
                            (local.tee $l53
                              (f64.load align=1
                                (i32.trunc_sat_f64_s
                                  (f64.add
                                    (local.get $p4)
                                    (f64.mul
                                      (f64.add
                                        (local.get $l39)
                                        (local.get $l52))
                                      (f64.const 0x1p+3 (;=8;)))))))
                            (call $f2
                              (local.get $l51)
                              (i32.const 1))))
                        (local.set $l41
                          (f64.add
                            (local.get $l41)
                            (f64.mul
                              (local.get $l54)
                              (local.get $l47))))
                        (local.set $l42
                          (f64.add
                            (local.get $l42)
                            (f64.mul
                              (local.get $l54)
                              (local.get $l48))))))))
                (local.set $l43
                  (f64.add
                    (local.get $l43)
                    (f64.const 0x1.4p+5 (;=40;))))
                (local.set $l44
                  (f64.add
                    (local.get $l44)
                    (f64.const 0x1p+0 (;=1;))))
                (br $L2))))
          (if $I7
            (f64.gt
              (f64.abs
                (local.get $l30))
              (f64.const 0x0p+0 (;=0;)))
            (then
              (local.set $l55
                (f64.sub
                  (local.get $l36)
                  (local.get $p12)))
              (local.set $l56
                (f64.sub
                  (local.get $l37)
                  (local.get $p14)))
              (if $I8
                (f64.ne
                  (f64.convert_i32_u
                    (f64.gt
                      (local.tee $l57
                        (f64.add
                          (f64.mul
                            (local.get $l55)
                            (local.get $l55))
                          (f64.mul
                            (local.get $l56)
                            (local.get $l56))))
                      (f64.const 0x0p+0 (;=0;))))
                  (f64.const 0x0p+0 (;=0;)))
                (then
                  (local.set $l58
                    (f64.div
                      (local.get $l32)
                      (f64.mul
                        (local.get $l57)
                        (local.get $p16))))
                  (local.set $l41
                    (f64.add
                      (local.get $l41)
                      (f64.mul
                        (local.get $l58)
                        (local.get $l55))))
                  (local.set $l42
                    (f64.add
                      (local.get $l42)
                      (f64.mul
                        (local.get $l58)
                        (local.get $l56))))))))
          (if $I9
            (f64.gt
              (f64.abs
                (local.get $l31))
              (f64.const 0x0p+0 (;=0;)))
            (then
              (if $I10
                (f64.ne
                  (f64.convert_i32_u
                    (f64.lt
                      (local.get $l36)
                      (local.get $p18)))
                  (f64.const 0x0p+0 (;=0;)))
                (then
                  (local.set $l41
                    (f64.add
                      (local.get $l41)
                      (f64.mul
                        (f64.sub
                          (local.get $p18)
                          (local.get $l36))
                        (local.get $l33))))))
              (if $I11
                (f64.ne
                  (f64.convert_i32_u
                    (f64.gt
                      (local.get $l36)
                      (f64.sub
                        (local.get $p20)
                        (local.get $p18))))
                  (f64.const 0x0p+0 (;=0;)))
                (then
                  (local.set $l41
                    (f64.add
                      (local.get $l41)
                      (f64.mul
                        (f64.sub
                          (f64.sub
                            (local.get $p20)
                            (local.get $p18))
                          (local.get $l36))
                        (local.get $l33))))))
              (if $I12
                (f64.ne
                  (f64.convert_i32_u
                    (f64.lt
                      (local.get $l37)
                      (local.get $p18)))
                  (f64.const 0x0p+0 (;=0;)))
                (then
                  (local.set $l42
                    (f64.add
                      (local.get $l42)
                      (f64.mul
                        (f64.sub
                          (local.get $p18)
                          (local.get $l37))
                        (local.get $l33))))))
              (if $I13
                (f64.ne
                  (f64.convert_i32_u
                    (f64.gt
                      (local.get $l37)
                      (f64.sub
                        (local.get $p22)
                        (local.get $p18))))
                  (f64.const 0x0p+0 (;=0;)))
                (then
                  (local.set $l42
                    (f64.add
                      (local.get $l42)
                      (f64.mul
                        (f64.sub
                          (f64.sub
                            (local.get $p22)
                            (local.get $p18))
                          (local.get $l37))
                        (local.get $l33))))))))
          (local.set $l42
            (f64.add
              (local.get $l42)
              (local.get $p24)))
          (local.set $l59
            (f64.load offset=16 align=1
              (i32.trunc_sat_f64_s
                (local.get $l34))))
          (local.set $l60
            (f64.load offset=24 align=1
              (i32.trunc_sat_f64_s
                (local.get $l34))))
          (local.set $l61
            (f64.add
              (f64.mul
                (local.get $l59)
                (local.get $l29))
              (f64.mul
                (local.get $l41)
                (local.get $p16))))
          (local.set $l62
            (f64.add
              (f64.mul
                (local.get $l60)
                (local.get $l29))
              (f64.mul
                (local.get $l42)
                (local.get $p16))))
          (f64.store offset=16 align=1
            (i32.trunc_sat_f64_s
              (local.get $l34))
            (local.get $l61))
          (f64.store offset=24 align=1
            (i32.trunc_sat_f64_s
              (local.get $l34))
            (local.get $l62))
          (local.set $l28
            (f64.add
              (local.tee $l28
                (f64.add
                  (local.get $l28)
                  (call $f4
                    (local.get $l61))))
              (call $f4
                (local.get $l62))))
          (local.set $l34
            (f64.add
              (local.get $l34)
              (f64.const 0x1.4p+5 (;=40;))))
          (local.set $l35
            (f64.add
              (local.get $l35)
              (f64.const 0x1p+0 (;=1;))))
          (br $L0))))
    (local.set $l34
      (local.get $p0))
    (local.set $l35
      (f64.const 0x0p+0 (;=0;)))
    (loop $L14
      (if $I15
        (f64.lt
          (local.get $l35)
          (local.get $p2))
        (then
          (local.set $l63
            (f64.add
              (f64.load align=1
                (i32.trunc_sat_f64_s
                  (local.get $l34)))
              (f64.load offset=16 align=1
                (i32.trunc_sat_f64_s
                  (local.get $l34)))))
          (local.set $l64
            (f64.add
              (f64.load offset=8 align=1
                (i32.trunc_sat_f64_s
                  (local.get $l34)))
              (f64.load offset=24 align=1
                (i32.trunc_sat_f64_s
                  (local.get $l34)))))
          (local.set $l65
            (f64.load offset=16 align=1
              (i32.trunc_sat_f64_s
                (local.get $l34))))
          (local.set $l66
            (f64.load offset=24 align=1
              (i32.trunc_sat_f64_s
                (local.get $l34))))
          (if $I16
            (f64.ne
              (f64.convert_i32_u
                (f64.lt
                  (local.get $l63)
                  (f64.const 0x0p+0 (;=0;))))
              (f64.const 0x0p+0 (;=0;)))
            (then
              (local.set $l63
                (f64.neg
                  (local.get $l63)))
              (local.set $l65
                (f64.mul
                  (local.get $l65)
                  (f64.const -0x1p+0 (;=-1;))))))
          (if $I17
            (f64.ne
              (f64.convert_i32_u
                (f64.ge
                  (local.get $l63)
                  (local.get $p20)))
              (f64.const 0x0p+0 (;=0;)))
            (then
              (local.set $l63
                (f64.sub
                  (f64.mul
                    (f64.const 0x1p+1 (;=2;))
                    (local.get $p20))
                  (local.get $l63)))
              (local.set $l65
                (f64.mul
                  (local.get $l65)
                  (f64.const -0x1p+0 (;=-1;))))))
          (if $I18
            (f64.ne
              (f64.convert_i32_u
                (f64.lt
                  (local.get $l64)
                  (f64.const 0x0p+0 (;=0;))))
              (f64.const 0x0p+0 (;=0;)))
            (then
              (local.set $l64
                (f64.neg
                  (local.get $l64)))
              (local.set $l66
                (f64.mul
                  (local.get $l66)
                  (f64.const -0x1p+0 (;=-1;))))))
          (if $I19
            (f64.ne
              (f64.convert_i32_u
                (f64.ge
                  (local.get $l64)
                  (local.get $p22)))
              (f64.const 0x0p+0 (;=0;)))
            (then
              (local.set $l64
                (f64.sub
                  (f64.mul
                    (f64.const 0x1p+1 (;=2;))
                    (local.get $p22))
                  (local.get $l64)))
              (local.set $l66
                (f64.mul
                  (local.get $l66)
                  (f64.const -0x1p+0 (;=-1;))))))
          (f64.store align=1
            (i32.trunc_sat_f64_s
              (local.get $l34))
            (local.get $l63))
          (f64.store offset=8 align=1
            (i32.trunc_sat_f64_s
              (local.get $l34))
            (local.get $l64))
          (f64.store offset=16 align=1
            (i32.trunc_sat_f64_s
              (local.get $l34))
            (local.get $l65))
          (f64.store offset=24 align=1
            (i32.trunc_sat_f64_s
              (local.get $l34))
            (local.get $l66))
          (local.set $l34
            (f64.add
              (local.get $l34)
              (f64.const 0x1.4p+5 (;=40;))))
          (local.set $l35
            (f64.add
              (local.get $l35)
              (f64.const 0x1p+0 (;=1;))))
          (br $L14))))
    (return
      (f64.div
        (local.get $l28)
        (local.get $p2))))
  (func $f2 (type $t2) (param $p0 f64) (param $p1 i32) (result f64)
    (local $l2 f64) (local $l3 f64)
    (if $I0
      (f64.le
        (local.get $p0)
        (f64.const 0x0p+0 (;=0;)))
      (then
        (if $I1
          (f64.eq
            (local.get $p0)
            (f64.const 0x0p+0 (;=0;)))
          (then
            (drop
              (return
                (local.get $p0)))))
        (drop
          (return
            (f64.const nan (;=nan;))))))
    (if $I2
      (f64.eq
        (call $f3
          (local.get $p0))
        (f64.const 0x0p+0 (;=0;)))
      (then
        (drop
          (return
            (local.get $p0)))))
    (local.set $l2
      (local.get $p0))
    (loop $L3
      (block $B4
        (local.set $l3
          (local.get $l2))
        (local.set $l2
          (f64.mul
            (f64.const 0x1p-1 (;=0.5;))
            (f64.add
              (local.get $l2)
              (f64.div
                (local.get $p0)
                (local.get $l2)))))
        (br_if $L3
          (f64.gt
            (call $f4
              (f64.sub
                (local.get $l3)
                (local.get $l2)))
            (f64.const 0x1.203af9ee75616p-50 (;=1e-15;))))))
    (return
      (local.get $l2)))
  (func $f3 (type $t3) (param $p0 f64) (result f64)
    (local $l1 f64)
    (f64.convert_i32_s
      (f64.eq
        (local.tee $l1
          (f64.sub
            (local.get $p0)
            (local.get $p0)))
        (local.get $l1))))
  (func $f4 (type $t3) (param $p0 f64) (result f64)
    (f64.abs
      (local.get $p0)))
  (memory $$ (export "$") 1))
